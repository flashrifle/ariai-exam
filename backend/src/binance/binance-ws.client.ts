/**
 * Binance combined stream 용 재연결 WS 클라이언트.
 *
 * 처리하는 실패 모드:
 * - Binance는 24시간마다 연결을 강제 종료한다 → 정상 상황으로 간주하고,
 *   안정적으로 유지되던 연결의 첫 재시도는 대기 없이 즉시 재연결한다.
 * - 서버가 3분마다 ping을 보낸다 → ws 라이브러리가 pong을 자동 응답하고(RFC 6455),
 *   여기서는 활동 시각을 추적해 일정 시간 무응답이면 좀비 연결로 판단해 강제 종료한다.
 * - 재연결 실패는 지수 백오프 + 지터로 재시도하며 대기 상한이 있다.
 * - 끊김 시각(disconnectedAt)과 복구 시각(reconnectedAt)을 상태 이벤트에 실어
 *   그 구간이 백필 대상 갭임을 상위(ingest)가 알 수 있게 한다.
 */
import { Logger } from '@nestjs/common';
import WebSocket, { type RawData } from 'ws';
import { BackoffPolicy, computeBackoffMs, DEFAULT_BACKOFF_POLICY } from './backoff';
import { describeError } from './error.util';

export type WsStatusKind = 'ws_open' | 'ws_close' | 'ws_error' | 'reconnect';

export interface WsStatusEvent {
  kind: WsStatusKind;
  connected: boolean;
  at: Date;
  message: string;
  /** 끊김이 시작된 시각 — 백필 대상 갭의 시작점. */
  disconnectedAt?: Date;
  /** 재연결이 완료된 시각 — 갭의 끝점. */
  reconnectedAt?: Date;
  downtimeMs?: number;
  attempt?: number;
  closeCode?: number;
}

export interface WsClientHandlers {
  onMessage: (raw: string) => void;
  onStatus: (event: WsStatusEvent) => void;
}

export interface BinanceWsClientOptions {
  /** 예: wss://stream.binance.com:9443 */
  baseUrl: string;
  /** 이 시간 동안 ping/메시지가 전혀 없으면 좀비 연결로 판단 (기본 240초 = ping 주기 3분 + 여유). */
  heartbeatTimeoutMs?: number;
  /** 하트비트 검사 주기 (기본 15초). */
  heartbeatCheckMs?: number;
  /** 이 시간 이상 유지된 연결은 "안정"으로 보고 재시도 횟수를 리셋 (기본 30초). */
  stableResetMs?: number;
  backoff?: BackoffPolicy;
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 240_000;
const DEFAULT_HEARTBEAT_CHECK_MS = 15_000;
const DEFAULT_STABLE_RESET_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const STOP_CLOSE_TIMEOUT_MS = 3_000;

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

export class BinanceWsClient {
  private readonly logger = new Logger(BinanceWsClient.name);
  private readonly baseUrl: string;
  private readonly heartbeatTimeoutMs: number;
  private readonly heartbeatCheckMs: number;
  private readonly stableResetMs: number;
  private readonly backoff: BackoffPolicy;

  private ws: WebSocket | null = null;
  private handlers: WsClientHandlers | null = null;
  private streams: string[] = [];
  private stopping = false;
  private reconnectAttempts = 0;
  private lastActivityAt = 0;
  private disconnectedAt: Date | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;

  constructor(options: BinanceWsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatCheckMs = options.heartbeatCheckMs ?? DEFAULT_HEARTBEAT_CHECK_MS;
    this.stableResetMs = options.stableResetMs ?? DEFAULT_STABLE_RESET_MS;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF_POLICY;
  }

  /** combined stream 연결 시작. 스트림 예: ['btcusdt@kline_1m', 'btcusdt@trade']. */
  start(streams: string[], handlers: WsClientHandlers): void {
    if (this.ws || this.reconnectTimer) {
      throw new Error('WS 클라이언트가 이미 시작되었습니다');
    }
    if (streams.length === 0) {
      throw new Error('구독할 스트림이 없습니다');
    }
    this.stopping = false;
    this.streams = [...streams];
    this.handlers = handlers;
    this.connect();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 정상 종료. close 완료를 기다리되 일정 시간 초과 시 강제 종료한다. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearReconnectTimer();
    this.clearConnectionTimers();
    const ws = this.ws;
    if (!ws) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ws.terminate();
        resolve();
      }, STOP_CLOSE_TIMEOUT_MS);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.close(1000, 'shutdown');
    });
    this.ws = null;
    this.logger.log('WS 정상 종료 완료');
  }

  private connect(): void {
    if (this.stopping) {
      return;
    }
    const url = `${this.baseUrl}/stream?streams=${this.streams.join('/')}`;
    this.logger.log(`WS 연결 시도: ${url}`);
    const ws = new WebSocket(url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
    this.ws = ws;
    ws.on('open', () => this.handleOpen());
    ws.on('message', (data) => this.handleMessage(data));
    // ws 라이브러리는 서버 ping에 pong을 자동 응답한다. 여기서는 활동 시각만 갱신.
    ws.on('ping', () => {
      this.lastActivityAt = Date.now();
    });
    ws.on('pong', () => {
      this.lastActivityAt = Date.now();
    });
    ws.on('error', (err) => this.handleError(err));
    ws.on('close', (code) => this.handleClose(code));
  }

  private handleOpen(): void {
    this.lastActivityAt = Date.now();
    this.startHeartbeat();
    // 일정 시간 안정적으로 유지되면 백오프 시도 횟수를 리셋한다
    this.stableTimer = setTimeout(() => {
      this.reconnectAttempts = 0;
    }, this.stableResetMs);
    const now = new Date();
    if (this.disconnectedAt) {
      const downtimeMs = now.getTime() - this.disconnectedAt.getTime();
      this.emitStatus({
        kind: 'reconnect',
        connected: true,
        at: now,
        message: `WS 재연결 성공 (끊김 ${downtimeMs}ms — 이 구간은 백필 대상 갭)`,
        disconnectedAt: this.disconnectedAt,
        reconnectedAt: now,
        downtimeMs,
        attempt: this.reconnectAttempts,
      });
      this.disconnectedAt = null;
    } else {
      this.emitStatus({ kind: 'ws_open', connected: true, at: now, message: 'WS 최초 연결 성공' });
    }
  }

  private handleMessage(data: RawData): void {
    this.lastActivityAt = Date.now();
    if (!this.handlers) {
      return;
    }
    try {
      this.handlers.onMessage(rawDataToString(data));
    } catch (err) {
      // 구독자 예외로 WS 클라이언트가 죽지 않도록 격리한다
      this.logger.error(`onMessage 처리 중 예외: ${describeError(err)}`);
    }
  }

  private handleError(err: Error): void {
    // 'error' 뒤에는 항상 'close'가 따라오므로 재연결은 close 핸들러가 담당한다
    this.logger.warn(`WS 오류: ${describeError(err)}`);
    this.emitStatus({
      kind: 'ws_error',
      connected: this.isConnected(),
      at: new Date(),
      message: `WS 오류: ${describeError(err)}`,
    });
  }

  private handleClose(code: number): void {
    this.clearConnectionTimers();
    this.ws = null;
    if (this.stopping) {
      return;
    }
    // 끊김 시작 시각 기록 — 복구 시점까지의 구간이 백필 대상 갭이 된다
    if (!this.disconnectedAt) {
      this.disconnectedAt = new Date();
    }
    this.emitStatus({
      kind: 'ws_close',
      connected: false,
      at: new Date(),
      closeCode: code,
      disconnectedAt: this.disconnectedAt,
      message: `WS 연결 종료 (code=${code}) — Binance는 24시간마다 연결을 끊으므로 정상 상황으로 간주하고 재연결`,
    });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }
    // 안정적으로 유지되던 연결(24시간 주기 강제 종료 등)은 즉시 재연결한다
    const delayMs =
      this.reconnectAttempts === 0 ? 0 : computeBackoffMs(this.reconnectAttempts, this.backoff);
    this.reconnectAttempts += 1;
    this.logger.log(`WS ${delayMs}ms 후 재연결 (attempt=${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), this.heartbeatCheckMs);
  }

  private checkHeartbeat(): void {
    if (!this.ws) {
      return;
    }
    const idleMs = Date.now() - this.lastActivityAt;
    if (idleMs > this.heartbeatTimeoutMs) {
      this.logger.warn(`WS 하트비트 타임아웃 (idle=${idleMs}ms) — 좀비 연결로 판단, 강제 종료 후 재연결`);
      // terminate → close 이벤트 발생 → 재연결 경로로 합류
      this.ws.terminate();
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearConnectionTimers(): void {
    this.clearHeartbeat();
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStatus(event: WsStatusEvent): void {
    if (!this.handlers) {
      return;
    }
    try {
      this.handlers.onStatus(event);
    } catch (err) {
      this.logger.error(`onStatus 처리 중 예외: ${describeError(err)}`);
    }
  }
}

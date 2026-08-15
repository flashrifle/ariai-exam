/**
 * 실시간 수집 파이프라인.
 *
 * WS 메시지 → zod 검증 → 도메인 이벤트 발행 + DB 기록.
 * - kline: 미확정 봉도 upsert(실시간 차트용), 확정 봉이면 KLINE_CLOSED 발행. source='ws'.
 * - trade: 건별 INSERT 금지 — 버퍼에 모아 주기/최대크기 도달 시 배치 삽입.
 * - ingest_state: 매 건 DB 기록 금지 — flush 시점에 배치 upsert.
 * - WS 끊김/복구 시각을 STREAM_STATUS 이벤트에 담아 발행하고 collector_events에 기록
 *   → 백필 담당자가 그 구간을 갭으로 복구한다.
 * - 종료(OnModuleDestroy) 시 버퍼를 반드시 flush 해 정상 종료 유실을 막는다.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceWsClient, type WsStatusEvent } from '../binance/binance-ws.client';
import { describeError } from '../binance/error.util';
import {
  AppEvents,
  type KlinePayload,
  type StreamStatusPayload,
  type TradePayload,
} from '../common/events';
import type { AppEnv, SupportedSymbol } from '../config/configuration';
import { KlineRepository } from '../db/repositories/kline.repository';
import { TradeRepository } from '../db/repositories/trade.repository';
import type { KlineInsert, TradeInsert } from '../db/schema';
import { IngestStateStore } from './ingest-state.store';
import { OpsEventRecorder } from './ops-event.recorder';
import {
  klineStreamKey,
  parseStreamMessage,
  tradeStreamKey,
  type ParsedKlineMessage,
  type ParsedTradeMessage,
} from './stream-message.parser';
import { TradeBuffer } from './trade-buffer';

import type { IngestPort, StreamHealthSnapshot } from '../common/ports';

/**
 * 운영 API(/ops/health)가 사용하는 스트림별 상태 스냅샷.
 *
 * 타입 정의는 `common/ports/ingest.port.ts`가 단일 진실 공급원이므로 그대로 재수출한다.
 * 여기서 같은 이름의 인터페이스를 따로 선언하면 구조적 타이핑 탓에 컴파일은 통과하면서
 * 런타임 필드만 어긋난다 (실제로 symbol·kind 누락 사고가 있었다).
 */
export type { StreamHealthSnapshot };

/** 파이프라인 내부 통계 (운영 진단용). */
export interface IngestStats {
  connected: boolean;
  bufferedTrades: number;
  /** 버퍼 하드캡 초과로 유실된 체결 누적 수. */
  droppedTrades: number;
  parseErrors: number;
  lastFlushAt: Date | null;
}

interface MutableStreamHealth {
  /** streamKey에서 매번 파싱하지 않도록 등록 시점에 함께 보관한다. */
  symbol: SupportedSymbol;
  kind: 'kline' | 'trade';
  lastEventAt: Date | null;
  lastEventTime: Date | null;
}

type FlushReason = 'interval' | 'maxRows' | 'shutdown';

@Injectable()
export class IngestService implements OnModuleInit, OnModuleDestroy, IngestPort {
  private readonly logger = new Logger(IngestService.name);
  private readonly symbols: readonly SupportedSymbol[];
  private readonly flushIntervalMs: number;
  private readonly buffer: TradeBuffer;

  private readonly health = new Map<string, MutableStreamHealth>();
  private streamsLabel = '';
  private connected = false;
  private flushTimer: NodeJS.Timeout | null = null;
  /** flush 직렬화 체인 — 동시 flush로 인한 중복 삽입/유실을 방지한다. */
  private flushChain: Promise<void> = Promise.resolve();
  private flushInFlight = false;
  /** 같은 캔들 갱신이 순서를 앞질러 덮어쓰지 않도록 kline 기록을 직렬화한다. */
  private klineChain: Promise<void> = Promise.resolve();

  private droppedTrades = 0;
  private parseErrors = 0;
  private lastFlushAt: Date | null = null;

  constructor(
    private readonly events: EventEmitter2,
    private readonly wsClient: BinanceWsClient,
    private readonly klineRepo: KlineRepository,
    private readonly tradeRepo: TradeRepository,
    private readonly stateStore: IngestStateStore,
    private readonly opsRecorder: OpsEventRecorder,
    config: ConfigService<AppEnv, true>,
  ) {
    this.symbols = config.get('SYMBOLS', { infer: true });
    this.flushIntervalMs = config.get('TRADE_FLUSH_INTERVAL_MS', { infer: true });
    this.buffer = new TradeBuffer({
      maxRows: config.get('TRADE_FLUSH_MAX_ROWS', { infer: true }),
    });
  }

  onModuleInit(): void {
    const streams = this.symbols.flatMap((symbol) => [
      `${symbol.toLowerCase()}@kline_1m`,
      `${symbol.toLowerCase()}@trade`,
    ]);
    this.streamsLabel = streams.join('/');
    for (const symbol of this.symbols) {
      this.health.set(klineStreamKey(symbol), {
        symbol,
        kind: 'kline',
        lastEventAt: null,
        lastEventTime: null,
      });
      this.health.set(tradeStreamKey(symbol), {
        symbol,
        kind: 'trade',
        lastEventAt: null,
        lastEventTime: null,
      });
    }
    this.wsClient.start(streams, {
      onMessage: (raw) => this.handleRawMessage(raw),
      onStatus: (event) => void this.handleStatus(event),
    });
    this.flushTimer = setInterval(() => void this.flush('interval'), this.flushIntervalMs);
    this.logger.log(`수집 시작: ${this.streamsLabel} (flush 주기 ${this.flushIntervalMs}ms)`);
  }

  /** 종료 시 버퍼를 반드시 flush — 안 하면 정상 종료에서도 데이터가 사라진다. */
  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.wsClient.stop();
    await this.klineChain;
    await this.flush('shutdown');
    if (this.buffer.size() > 0) {
      // 첫 flush가 실패해 복원됐을 수 있으니 한 번 더 시도한다
      await this.flush('shutdown');
    }
    if (this.buffer.size() > 0) {
      this.logger.error(`종료 시 체결 ${this.buffer.size()}건을 기록하지 못했습니다 (유실)`);
    } else {
      this.logger.log('수집 종료: 종료 flush 완료');
    }
  }

  /** 스트림별 마지막 수신 상태 — 운영 API(/ops/health) 담당자가 사용한다. */
  getStreamHealth(): StreamHealthSnapshot[] {
    const now = Date.now();
    return [...this.health.entries()].map(([streamKey, health]) => ({
      streamKey,
      symbol: health.symbol,
      kind: health.kind,
      connected: this.connected,
      lastEventAt: health.lastEventAt,
      // 계약상 초 단위. API 레이어가 응답 시각 기준으로 다시 계산하지만, 여기서도 채워 둔다.
      lagSeconds: health.lastEventAt ? (now - health.lastEventAt.getTime()) / 1000 : null,
    }));
  }

  /** 파이프라인 내부 통계 — 운영 진단용. */
  getIngestStats(): IngestStats {
    return {
      connected: this.connected,
      bufferedTrades: this.buffer.size(),
      droppedTrades: this.droppedTrades,
      parseErrors: this.parseErrors,
      lastFlushAt: this.lastFlushAt,
    };
  }

  // ── WS 메시지 처리 ─────────────────────────────────────────────────────

  private handleRawMessage(raw: string): void {
    let message: ParsedKlineMessage | ParsedTradeMessage;
    try {
      message = parseStreamMessage(raw);
    } catch (err) {
      this.parseErrors += 1;
      this.logger.warn(`WS 메시지 파싱 실패 (누적 ${this.parseErrors}건): ${describeError(err)}`);
      return;
    }
    if (message.type === 'kline') {
      this.handleKline(message);
    } else {
      this.handleTrade(message);
    }
  }

  private handleKline(message: ParsedKlineMessage): void {
    const payload = message.payload;
    const streamKey = klineStreamKey(payload.symbol);
    this.touchHealth(streamKey, message.eventTime);
    this.stateStore.markKline(streamKey, message.eventTime);
    this.klineChain = this.klineChain.then(() => this.writeAndEmitKline(payload));
  }

  private async writeAndEmitKline(payload: KlinePayload): Promise<void> {
    try {
      // 미확정 봉도 upsert 해 실시간 차트가 움직이게 한다 (idempotent upsert)
      await this.klineRepo.upsertMany([toKlineInsert(payload)]);
    } catch (err) {
      // 미확정 봉은 다음 갱신이 다시 upsert 하므로 자연 회복되고,
      // 확정 봉 누락은 백필의 갭 스캔이 복구한다 — 유실을 로그로 남긴다
      this.logger.error(
        `kline upsert 실패 (${payload.symbol} ${payload.openTime.toISOString()}, closed=${payload.isClosed}): ${describeError(err)}`,
      );
    }
    // DB 기록 후 발행 — KLINE_CLOSED 구독자(지표)가 DB를 읽기 때문
    this.events.emit(AppEvents.KLINE_UPDATED, payload);
    if (payload.isClosed) {
      this.events.emit(AppEvents.KLINE_CLOSED, payload);
    }
  }

  private handleTrade(message: ParsedTradeMessage): void {
    const payload = message.payload;
    const streamKey = tradeStreamKey(payload.symbol);
    this.touchHealth(streamKey, message.eventTime);
    this.stateStore.markTrade(streamKey, message.eventTime, payload.tradeId);
    // 실시간 전송(SSE)은 지연이 중요하므로 DB 기록과 무관하게 즉시 발행한다
    this.events.emit(AppEvents.TRADE_RECEIVED, payload);
    const reachedMax = this.buffer.add(toTradeInsert(payload));
    if (reachedMax && !this.flushInFlight) {
      void this.flush('maxRows');
    }
  }

  private touchHealth(streamKey: string, eventTime: Date): void {
    const current = this.health.get(streamKey);
    if (current === undefined) {
      // 등록되지 않은 스트림의 메시지 — 구독 목록과 파서가 어긋난 상황이므로 조용히 넘기지 않는다.
      this.logger.warn(`등록되지 않은 스트림의 이벤트를 수신했습니다: ${streamKey}`);
      return;
    }
    this.health.set(streamKey, { ...current, lastEventAt: new Date(), lastEventTime: eventTime });
  }

  // ── 배치 flush ─────────────────────────────────────────────────────────

  private flush(reason: FlushReason): Promise<void> {
    // 직렬화 체인에 연결 — doFlush는 내부에서 오류를 처리하므로 체인이 끊기지 않는다
    const next = this.flushChain.then(() => this.doFlush(reason));
    this.flushChain = next;
    return next;
  }

  private async doFlush(reason: FlushReason): Promise<void> {
    this.flushInFlight = true;
    try {
      await this.flushTrades(reason);
      await this.flushState();
    } finally {
      this.flushInFlight = false;
    }
  }

  private async flushTrades(reason: FlushReason): Promise<void> {
    const rows = this.buffer.drain();
    if (rows.length === 0) {
      return;
    }
    try {
      const written = await this.tradeRepo.insertManyIgnoreConflict(rows);
      this.lastFlushAt = new Date();
      if (reason === 'shutdown') {
        this.logger.log(`종료 flush: 체결 ${rows.length}건 기록 (신규 ${written}건)`);
      }
    } catch (err) {
      // 조용히 버리지 않는다: 버퍼에 복원해 재시도하고, 상한 초과 유실만 집계해 알린다
      const result = this.buffer.restore(rows);
      if (result.dropped > 0) {
        this.droppedTrades += result.dropped;
        this.logger.error(
          `체결 flush 실패 — 버퍼 상한 초과로 ${result.dropped}건 유실 (누적 ${this.droppedTrades}건): ${describeError(err)}`,
        );
      } else {
        this.logger.error(
          `체결 flush 실패 — ${rows.length}건 버퍼 복원, 다음 flush에서 재시도: ${describeError(err)}`,
        );
      }
    }
  }

  private async flushState(): Promise<void> {
    try {
      await this.stateStore.flush();
    } catch (err) {
      this.logger.error(`ingest_state 갱신 실패 — 다음 flush에서 재시도: ${describeError(err)}`);
    }
  }

  // ── WS 연결 상태 처리 ──────────────────────────────────────────────────

  /**
   * 끊김/복구 시각을 STREAM_STATUS 이벤트 meta에 담아 스트림별로 발행하고
   * collector_events에 기록한다. 백필 담당자는 meta의
   * disconnectedAt~reconnectedAt 구간을 갭으로 복구한다.
   */
  private async handleStatus(event: WsStatusEvent): Promise<void> {
    this.connected = event.connected;
    const meta: Record<string, unknown> = {
      ...(event.disconnectedAt && { disconnectedAt: event.disconnectedAt.toISOString() }),
      ...(event.reconnectedAt && { reconnectedAt: event.reconnectedAt.toISOString() }),
      ...(event.downtimeMs !== undefined && { downtimeMs: event.downtimeMs }),
      ...(event.attempt !== undefined && { attempt: event.attempt }),
      ...(event.closeCode !== undefined && { closeCode: event.closeCode }),
    };
    for (const streamKey of this.health.keys()) {
      const payload: StreamStatusPayload = {
        streamKey,
        connected: event.connected,
        reason: event.kind,
        at: event.at,
        meta,
      };
      this.events.emit(AppEvents.STREAM_STATUS, payload);
    }
    const level = event.kind === 'ws_error' ? 'error' : event.connected ? 'info' : 'warn';
    await this.opsRecorder.record(level, event.kind, this.streamsLabel, event.message, meta);
  }
}

// ── 도메인 → DB 행 매퍼 (가격/수량은 문자열 그대로, 시각은 UTC Date) ───────

function toKlineInsert(payload: KlinePayload): KlineInsert {
  return {
    symbol: payload.symbol,
    interval: payload.interval,
    openTime: payload.openTime,
    closeTime: payload.closeTime,
    open: payload.open,
    high: payload.high,
    low: payload.low,
    close: payload.close,
    volume: payload.volume,
    quoteVolume: payload.quoteVolume,
    tradeCount: payload.tradeCount,
    takerBuyBase: payload.takerBuyBase,
    takerBuyQuote: payload.takerBuyQuote,
    source: 'ws',
  };
}

function toTradeInsert(payload: TradePayload): TradeInsert {
  return {
    symbol: payload.symbol,
    tradeId: payload.tradeId,
    price: payload.price,
    qty: payload.qty,
    quoteQty: payload.quoteQty,
    tradeTime: payload.tradeTime,
    isBuyerMaker: payload.isBuyerMaker,
  };
}

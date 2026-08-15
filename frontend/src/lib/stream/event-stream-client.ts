/**
 * SSE(`GET /stream`) 클라이언트.
 *
 * React 밖에서 연결을 소유하는 이유:
 *  · `tick` 은 초당 수십 건이 들어온다. 이벤트마다 setState 하면 렌더가 폭주한다.
 *    → 버퍼에 쌓고 requestAnimationFrame + 최소 간격으로 **배치 플러시**한다.
 *  · 브라우저 탭이 백그라운드면 rAF 가 멈춘다. 그때 버퍼가 무한히 자라지 않도록
 *    상한을 두고 오래된 것부터 버린다.
 *  · EventSource 의 기본 재연결은 백오프가 없다. 직접 close 후 지수 백오프로 재연결한다.
 */
import {
  candleEventSchema,
  metricsEventSchema,
  opsEventSchema,
  tickEventSchema,
} from '@/lib/schemas';
import type { CandleEvent, MetricsEvent, OpsEvent, TickEvent } from '@/types/api';

export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed';

/**
 * useSyncExternalStore 로 구독하는 연결 상태.
 * 매 틱 바뀌는 값(마지막 수신 시각)은 여기 넣지 않는다 —
 * 스냅샷 참조가 매번 달라지면 렌더 루프가 발생한다. `getLastEventAt()` 로 따로 읽는다.
 */
export interface StreamSnapshot {
  status: StreamStatus;
  /** 연속 재연결 시도 횟수. 연결 성공 시 0 으로 초기화. */
  attempt: number;
  /** 마지막 오류 메시지 (계약 위반 포함). */
  lastError: string | null;
  /** 스키마 검증에 실패한 누적 메시지 수. 0 이 아니면 백엔드 계약 위반 신호. */
  invalidCount: number;
}

export interface StreamHandlers {
  /** rAF 배치로 모아서 전달되는 체결 틱. */
  onTicks?: (ticks: readonly TickEvent[]) => void;
  /** (symbol, interval, openTime) 별 최신 봉만 남긴 배치. */
  onCandles?: (candles: readonly CandleEvent[]) => void;
  onMetrics?: (event: MetricsEvent) => void;
  onOps?: (event: OpsEvent) => void;
}

/** EventSource 가 만족하는 최소 인터페이스. 목 스트림도 이걸 구현한다. */
export interface StreamSourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export type StreamSourceFactory = (url: string) => StreamSourceLike;

/** 고빈도 이벤트의 최소 플러시 간격 (ms). 초당 최대 ~8회만 반영. */
const FLUSH_INTERVAL_MS = 120;
/** 백그라운드 탭 등으로 플러시가 밀릴 때 유지할 최대 틱 수. */
const MAX_TICK_BUFFER = 240;
/**
 * 봉 버퍼 상한. 심볼 2 × 인터벌 4 = 8키가 정상 범위지만,
 * 탭이 백그라운드로 내려가 rAF 가 멈추면 openTime 이 바뀔 때마다 키가 늘어난다.
 */
const MAX_CANDLE_BUFFER = 64;
/** 지수 백오프 지연 단계 (ms). */
const BACKOFF_STEPS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000] as const;

const IDLE_SNAPSHOT: StreamSnapshot = {
  status: 'idle',
  attempt: 0,
  lastError: null,
  invalidCount: 0,
};

type ParseResult = { ok: true; value: unknown } | { ok: false };

function backoffDelay(attempt: number): number {
  const index = Math.min(attempt, BACKOFF_STEPS_MS.length - 1);
  const base = BACKOFF_STEPS_MS[index] ?? 15_000;
  // ±20% 지터로 동시 재연결(thundering herd)을 흩뜨린다.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

const defaultFactory: StreamSourceFactory = (url) => new EventSource(url);

export class EventStreamClient {
  private readonly url: string;
  private readonly createSource: StreamSourceFactory;

  private source: StreamSourceLike | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private lastFlushAt = 0;
  private stopped = true;

  private snapshot: StreamSnapshot = IDLE_SNAPSHOT;
  private lastEventAtMs: number | null = null;
  private readonly statusListeners = new Set<() => void>();
  private readonly handlers = new Set<StreamHandlers>();

  private tickBuffer: TickEvent[] = [];
  private readonly candleBuffer = new Map<string, CandleEvent>();

  constructor(url: string, createSource: StreamSourceFactory = defaultFactory) {
    this.url = url;
    this.createSource = createSource;
  }

  /* ── 구독 ──────────────────────────────────────────────────── */

  subscribe(handlers: StreamHandlers): () => void {
    this.handlers.add(handlers);
    return () => {
      this.handlers.delete(handlers);
    };
  }

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  /** useSyncExternalStore 용. 변경이 없으면 같은 객체 참조를 돌려준다. */
  getSnapshot = (): StreamSnapshot => this.snapshot;

  getServerSnapshot = (): StreamSnapshot => IDLE_SNAPSHOT;

  /** 마지막으로 유효한 이벤트를 받은 시각 (epoch ms). */
  getLastEventAt = (): number | null => this.lastEventAtMs;

  /* ── 연결 수명주기 ─────────────────────────────────────────── */

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
    }
    this.connect(0);
  }

  stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.cancelFlush();
    this.closeSource();
    this.tickBuffer = [];
    this.candleBuffer.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
    }
    this.patch({ status: 'closed' });
  }

  /** 네트워크가 돌아오면 백오프 대기를 건너뛰고 즉시 재시도한다. */
  private handleOnline = (): void => {
    if (this.stopped || this.snapshot.status !== 'reconnecting') return;
    this.clearRetry();
    this.connect(this.snapshot.attempt);
  };

  private connect(attempt: number): void {
    if (this.stopped) return;
    this.closeSource();
    this.patch({ status: attempt === 0 ? 'connecting' : 'reconnecting', attempt });

    let source: StreamSourceLike;
    try {
      source = this.createSource(this.url);
    } catch (error) {
      this.scheduleRetry(error instanceof Error ? error.message : '스트림을 열 수 없습니다');
      return;
    }
    this.source = source;

    source.addEventListener('open', () => {
      if (this.stopped) return;
      this.patch({ status: 'live', attempt: 0, lastError: null });
    });

    source.addEventListener('error', () => {
      if (this.stopped) return;
      // EventSource 자체 재연결에 맡기지 않고 직접 백오프로 제어한다.
      this.closeSource();
      this.scheduleRetry('스트림 연결이 끊어졌습니다');
    });

    source.addEventListener('tick', (event) => this.handleTick(event));
    source.addEventListener('candle', (event) => this.handleCandle(event));
    source.addEventListener('metrics', (event) => this.handleMetrics(event));
    source.addEventListener('ops', (event) => this.handleOps(event));
  }

  private scheduleRetry(message: string): void {
    if (this.stopped || this.retryTimer !== null) return;
    const current = this.snapshot.attempt;
    this.patch({ status: 'reconnecting', attempt: current + 1, lastError: message });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(current + 1);
    }, backoffDelay(current));
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private closeSource(): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  /* ── 이벤트 처리 ───────────────────────────────────────────── */

  private parse(event: Event): ParseResult {
    const raw = (event as MessageEvent<unknown>).data;
    if (typeof raw !== 'string') {
      this.reportInvalid('SSE 페이로드가 문자열이 아닙니다');
      return { ok: false };
    }
    try {
      return { ok: true, value: JSON.parse(raw) as unknown };
    } catch {
      this.reportInvalid('SSE 페이로드를 JSON 으로 해석할 수 없습니다');
      return { ok: false };
    }
  }

  private reportInvalid(message: string): void {
    this.patch({ lastError: message, invalidCount: this.snapshot.invalidCount + 1 });
  }

  private markAlive(): void {
    this.lastEventAtMs = Date.now();
    if (this.snapshot.status !== 'live' || this.snapshot.attempt !== 0) {
      this.patch({ status: 'live', attempt: 0 });
    }
  }

  private handleTick(event: Event): void {
    // stop() 이후 브라우저 큐에 남아 있던 이벤트가 늦게 도착해도 무시한다.
    if (this.stopped) return;
    const parsedJson = this.parse(event);
    if (!parsedJson.ok) return;
    const parsed = tickEventSchema.safeParse(parsedJson.value);
    if (!parsed.success) {
      this.reportInvalid('tick 이벤트가 계약과 다릅니다');
      return;
    }
    this.markAlive();
    this.tickBuffer.push(parsed.data);
    if (this.tickBuffer.length > MAX_TICK_BUFFER) {
      this.tickBuffer = this.tickBuffer.slice(-MAX_TICK_BUFFER);
    }
    this.scheduleFlush();
  }

  private handleCandle(event: Event): void {
    // stop() 이후 브라우저 큐에 남아 있던 이벤트가 늦게 도착해도 무시한다.
    if (this.stopped) return;
    const parsedJson = this.parse(event);
    if (!parsedJson.ok) return;
    const parsed = candleEventSchema.safeParse(parsedJson.value);
    if (!parsed.success) {
      this.reportInvalid('candle 이벤트가 계약과 다릅니다');
      return;
    }
    this.markAlive();
    const { symbol, interval, candle } = parsed.data;
    this.candleBuffer.set(`${symbol}:${interval}:${candle.openTime}`, parsed.data);
    // 백그라운드 탭에서 rAF 가 멈춘 사이 openTime 키가 계속 늘어나는 것을 막는다.
    while (this.candleBuffer.size > MAX_CANDLE_BUFFER) {
      const oldest = this.candleBuffer.keys().next();
      if (oldest.done) break;
      this.candleBuffer.delete(oldest.value);
    }
    this.scheduleFlush();
  }

  private handleMetrics(event: Event): void {
    // stop() 이후 브라우저 큐에 남아 있던 이벤트가 늦게 도착해도 무시한다.
    if (this.stopped) return;
    const parsedJson = this.parse(event);
    if (!parsedJson.ok) return;
    const parsed = metricsEventSchema.safeParse(parsedJson.value);
    if (!parsed.success) {
      this.reportInvalid('metrics 이벤트가 계약과 다릅니다');
      return;
    }
    this.markAlive();
    for (const handler of this.handlers) handler.onMetrics?.(parsed.data);
  }

  private handleOps(event: Event): void {
    // stop() 이후 브라우저 큐에 남아 있던 이벤트가 늦게 도착해도 무시한다.
    if (this.stopped) return;
    const parsedJson = this.parse(event);
    if (!parsedJson.ok) return;
    const parsed = opsEventSchema.safeParse(parsedJson.value);
    if (!parsed.success) {
      this.reportInvalid('ops 이벤트가 계약과 다릅니다');
      return;
    }
    this.markAlive();
    for (const handler of this.handlers) handler.onOps?.(parsed.data);
  }

  /* ── 배치 플러시 ───────────────────────────────────────────── */

  private scheduleFlush(): void {
    if (this.rafId !== null || typeof window === 'undefined') return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      const now = performance.now();
      if (now - this.lastFlushAt < FLUSH_INTERVAL_MS) {
        this.scheduleFlush();
        return;
      }
      this.lastFlushAt = now;
      this.flush();
    });
  }

  private cancelFlush(): void {
    if (this.rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private flush(): void {
    if (this.tickBuffer.length > 0) {
      const ticks = this.tickBuffer;
      this.tickBuffer = [];
      for (const handler of this.handlers) handler.onTicks?.(ticks);
    }
    if (this.candleBuffer.size > 0) {
      const candles = Array.from(this.candleBuffer.values());
      this.candleBuffer.clear();
      for (const handler of this.handlers) handler.onCandles?.(candles);
    }
  }

  /* ── 스냅샷 갱신 ───────────────────────────────────────────── */

  private patch(next: Partial<StreamSnapshot>): void {
    const merged: StreamSnapshot = { ...this.snapshot, ...next };
    const changed =
      merged.status !== this.snapshot.status ||
      merged.attempt !== this.snapshot.attempt ||
      merged.lastError !== this.snapshot.lastError ||
      merged.invalidCount !== this.snapshot.invalidCount;
    if (!changed) return;
    this.snapshot = merged;
    for (const listener of this.statusListeners) listener();
  }
}

/**
 * 목 SSE 소스 — **개발 중 화면 확인 전용**.
 * 실제 `EventSource` 와 동일한 이벤트 이름(tick/candle/metrics/ops)으로 쏜다.
 */
import {
  buildCandles,
  buildMetricsOverview,
  buildOpsHealth,
  currentPrice,
} from '@/lib/mock/market-sim';
import type { StreamSourceLike } from '@/lib/stream/event-stream-client';
import type {
  CandleEvent,
  Interval,
  MetricsEvent,
  OpsEvent,
  Symbol as TradingSymbol,
  TickEvent,
} from '@/types/api';

const SYMBOLS: readonly TradingSymbol[] = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS: readonly Interval[] = ['1m', '5m', '15m', '1h'];

const TICK_MS = 90;
const CANDLE_MS = 1_500;
const METRICS_MS = 2_000;
const OPS_MS = 5_000;
const OPEN_DELAY_MS = 250;

class MockEventSource implements StreamSourceLike {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor() {
    this.openTimer = setTimeout(() => {
      if (this.closed) return;
      this.dispatch('open', new Event('open'));
      this.startEmitting();
    }, OPEN_DELAY_MS);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  close(): void {
    this.closed = true;
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    this.listeners.clear();
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  private emit(type: string, payload: unknown): void {
    if (this.closed) return;
    this.dispatch(type, new MessageEvent(type, { data: JSON.stringify(payload) }));
  }

  private startEmitting(): void {
    this.timers.push(
      setInterval(() => {
        for (const symbol of SYMBOLS) this.emit('tick', makeTick(symbol));
      }, TICK_MS),
    );

    this.timers.push(
      setInterval(() => {
        for (const symbol of SYMBOLS) {
          for (const interval of INTERVALS) {
            const event = makeCandleEvent(symbol, interval);
            if (event) this.emit('candle', event);
          }
        }
      }, CANDLE_MS),
    );

    this.timers.push(
      setInterval(() => {
        for (const symbol of SYMBOLS) {
          const event: MetricsEvent = { overview: buildMetricsOverview(symbol) };
          this.emit('metrics', event);
        }
      }, METRICS_MS),
    );

    this.timers.push(
      setInterval(() => {
        const event: OpsEvent = { health: buildOpsHealth() };
        this.emit('ops', event);
      }, OPS_MS),
    );
  }
}

function makeTick(symbol: TradingSymbol): TickEvent {
  const base = currentPrice(symbol);
  const jitter = base * 0.00012 * (Math.random() - 0.5);
  return {
    symbol,
    price: Math.round((base + jitter) * 100) / 100,
    qty: Math.round((symbol === 'BTCUSDT' ? 0.05 : 0.9) * (0.2 + Math.random() * 3) * 1e5) / 1e5,
    // 살짝 매수 우위로 기울여 체결강도 바가 0.5 위에서 놀게 한다.
    isBuyerMaker: Math.random() > 0.54,
    tradeTime: new Date().toISOString(),
  };
}

function makeCandleEvent(symbol: TradingSymbol, interval: Interval): CandleEvent | null {
  const [candle] = buildCandles(symbol, interval, 1);
  if (!candle) return null;
  return { symbol, interval, candle, isClosed: false };
}

export function createMockEventSource(_url: string): StreamSourceLike {
  return new MockEventSource();
}

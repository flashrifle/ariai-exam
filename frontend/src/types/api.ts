/**
 * 프론트엔드 ↔ 백엔드 API 계약.
 * 백엔드 DTO(`backend/src/api/dto`)는 이 타입과 필드명·형태가 정확히 일치해야 한다.
 * 시각은 모두 ISO 8601 UTC 문자열, 수치는 표시 목적의 number 이다.
 */

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export type Symbol = 'BTCUSDT' | 'ETHUSDT';
export type Interval = '1m' | '5m' | '15m' | '1h';

export interface Candle {
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
  takerBuyQuote: number;
}

/** 지표 카드 스냅샷. 각 지표의 선정 근거는 docs/METRICS.md 참조. */
export interface MetricsOverview {
  symbol: Symbol;
  asOf: string;
  lastPrice: number;
  /** 24시간 전 대비 변화율 (%) */
  priceChangePct24h: number;
  /** 24시간 거래대금 (USDT) */
  quoteVolume24h: number;
  /** 최근 N분 VWAP */
  vwap: number;
  /** 현재가와 VWAP의 이격도 (%) — 양수면 평균 체결가보다 비싸게 거래 중 */
  vwapDeviationPct: number;
  /** 1분 수익률 기준 연율화 실현변동성 (%) */
  realizedVolatility: number;
  /** taker 매수 체결대금 비중 (0~1). 0.5 초과면 시장가 매수 우위 */
  takerBuyRatio: number;
  /** 최근 1분 체결 건수 */
  tradeCount1m: number;
  /** 직전 동일 구간 대비 거래대금 배수 (거래량 이상 감지) */
  volumeSurgeRatio: number;
}

export interface MetricPoint {
  ts: string;
  value: number;
}

export interface MetricSeries {
  symbol: Symbol;
  metric: string;
  window: string;
  points: MetricPoint[];
}

/** 스트림 1개(kline 또는 trade)의 수집 건강도. */
export interface StreamHealth {
  streamKey: string;
  symbol: Symbol;
  kind: 'kline' | 'trade';
  connected: boolean;
  /** 마지막 이벤트 수신 시각 */
  lastEventAt: string | null;
  /** 마지막 이벤트로부터 경과한 초 — 파이프라인 지연의 핵심 지표 */
  lagSeconds: number | null;
}

export interface OpsHealth {
  serverTime: string;
  /** 프로세스 기동 후 경과 초 */
  uptimeSeconds: number;
  streams: StreamHealth[];
  /** 최근 24시간 1분봉 커버리지 (0~1). 1이면 무결점 */
  coverage: {
    symbol: Symbol;
    interval: Interval;
    expected: number;
    actual: number;
    ratio: number;
    missingRanges: { from: string; to: string }[];
  }[];
  backfill: {
    running: number;
    pending: number;
    failed24h: number;
    lastSucceededAt: string | null;
  };
}

export interface BackfillJob {
  id: number;
  symbol: Symbol;
  interval: Interval;
  rangeStart: string;
  rangeEnd: string;
  reason: 'bootstrap' | 'gap_recovery' | 'manual';
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  rowsWritten: number;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CollectorEvent {
  id: number;
  ts: string;
  level: 'info' | 'warn' | 'error';
  kind: string;
  stream: string | null;
  message: string;
  meta: Record<string, unknown> | null;
}

/* ── SSE 페이로드 ─────────────────────────────────────────────── */

export interface TickEvent {
  symbol: Symbol;
  price: number;
  qty: number;
  /** true면 시장가 매도(매수자가 maker) */
  isBuyerMaker: boolean;
  tradeTime: string;
}

export interface CandleEvent {
  symbol: Symbol;
  interval: Interval;
  candle: Candle;
  /** 봉이 확정되었는지 여부 */
  isClosed: boolean;
}

export interface MetricsEvent {
  overview: MetricsOverview;
}

export interface OpsEvent {
  health: OpsHealth;
}

export type SseEventName = 'tick' | 'candle' | 'metrics' | 'ops';

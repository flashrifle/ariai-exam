/**
 * 프론트엔드 계약 타입의 백엔드 미러.
 *
 * 원본은 `frontend/src/types/api.ts` 이며, 두 워크스페이스가 분리돼 있어 직접 import 할 수 없다.
 * **필드명·형태를 글자 단위로 동일하게 유지할 것.** 원본이 바뀌면 이 파일도 같이 고쳐야 한다.
 *
 * - 시각: 전부 ISO 8601 UTC 문자열
 * - 수치: 표시 목적의 number (DB numeric → API 경계에서 변환)
 */
import type { SupportedInterval, SupportedSymbol } from '../../config/configuration';

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

/** 지표 카드 스냅샷. */
export interface MetricsOverview {
  symbol: SupportedSymbol;
  asOf: string;
  lastPrice: number;
  /** 24시간 전 대비 변화율 (%) */
  priceChangePct24h: number;
  /** 24시간 거래대금 (USDT) */
  quoteVolume24h: number;
  /** 최근 N분 VWAP */
  vwap: number;
  /** 현재가와 VWAP의 이격도 (%) */
  vwapDeviationPct: number;
  /** 1분 수익률 기준 연율화 실현변동성 (%) */
  realizedVolatility: number;
  /** taker 매수 체결대금 비중 (0~1) */
  takerBuyRatio: number;
  /** 최근 1분 체결 건수 */
  tradeCount1m: number;
  /** 직전 동일 구간 대비 거래대금 배수 */
  volumeSurgeRatio: number;
}

export interface MetricPoint {
  ts: string;
  value: number;
}

export interface MetricSeries {
  symbol: SupportedSymbol;
  metric: string;
  window: string;
  points: MetricPoint[];
}

/** 스트림 1개(kline 또는 trade)의 수집 건강도. */
export interface StreamHealth {
  streamKey: string;
  symbol: SupportedSymbol;
  kind: 'kline' | 'trade';
  connected: boolean;
  /** 마지막 이벤트 수신 시각 */
  lastEventAt: string | null;
  /** 마지막 이벤트로부터 경과한 초 — 파이프라인 지연의 핵심 지표 */
  lagSeconds: number | null;
}

export interface CoverageRange {
  from: string;
  to: string;
}

export interface CoverageReport {
  symbol: SupportedSymbol;
  interval: SupportedInterval;
  expected: number;
  actual: number;
  ratio: number;
  missingRanges: CoverageRange[];
}

export interface BackfillSummary {
  running: number;
  pending: number;
  failed24h: number;
  lastSucceededAt: string | null;
}

export interface OpsHealth {
  serverTime: string;
  /** 프로세스 기동 후 경과 초 */
  uptimeSeconds: number;
  streams: StreamHealth[];
  /** 최근 24시간 1분봉 커버리지 (0~1). 1이면 무결점 */
  coverage: CoverageReport[];
  backfill: BackfillSummary;
}

export type BackfillReason = 'bootstrap' | 'gap_recovery' | 'manual';
export type BackfillStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface BackfillJob {
  id: number;
  symbol: SupportedSymbol;
  interval: SupportedInterval;
  rangeStart: string;
  rangeEnd: string;
  reason: BackfillReason;
  status: BackfillStatus;
  rowsWritten: number;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type CollectorEventLevel = 'info' | 'warn' | 'error';

export interface CollectorEvent {
  id: number;
  ts: string;
  level: CollectorEventLevel;
  kind: string;
  stream: string | null;
  message: string;
  meta: Record<string, unknown> | null;
}

/* ── SSE 페이로드 ─────────────────────────────────────────────── */

export interface TickEvent {
  symbol: SupportedSymbol;
  price: number;
  qty: number;
  /** true면 시장가 매도(매수자가 maker) */
  isBuyerMaker: boolean;
  tradeTime: string;
}

export interface CandleEvent {
  symbol: SupportedSymbol;
  interval: SupportedInterval;
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

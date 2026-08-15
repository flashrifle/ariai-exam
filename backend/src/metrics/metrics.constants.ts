/**
 * 지표 모듈 전용 상수·이벤트 정의.
 *
 * metrics 전용 이벤트는 backend/src/common/events.ts 스타일을 따르되
 * 이 모듈 안에서 정의한다 (공용 파일은 다른 담당자 소유이므로 수정하지 않는다).
 */
import type { SupportedInterval } from '../config/configuration';
import type { MetricsOverview } from './metrics.types';

/**
 * 지표 모듈이 발행하는 이벤트.
 * realtime(SSE) 담당자는 `metrics.updated` 를 구독해
 * SSE `metrics` 이벤트(페이로드: MetricsEvent = { overview })로 그대로 전달하면 된다.
 */
export const MetricsEvents = {
  /** 지표 스냅샷 갱신. METRICS_REFRESH_MS 주기 + kline.closed 확정 시 발행. */
  METRICS_UPDATED: 'metrics.updated',
} as const;

/** metrics.updated 페이로드 — 프론트 SSE MetricsEvent 와 동일한 형태. */
export interface MetricsUpdatedPayload {
  overview: MetricsOverview;
}

/** 1년의 분 수 = 365일 × 24시간 × 60분. 1분 수익률 변동성 연율화 계수(√525600)의 밑. */
export const MINUTES_PER_YEAR = 525_600;

/** 시계열용 롤링 실현변동성의 표본 개수(분). 30분 표본으로 지역적 변동성을 추정한다. */
export const ROLLING_VOL_SAMPLES = 30;

/** 인터벌 → 초. 시간 버킷(floor(epoch / N) * N) 계산의 기준. */
export const INTERVAL_SECONDS: Record<SupportedInterval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
};

/** getSeries 가 지원하는 지표 이름 (프론트 쿼리 파라미터 값과 일치). */
export const SERIES_METRICS = [
  'vwap',
  'realizedVolatility',
  'takerBuyRatio',
  'quoteVolume',
] as const;

export type SeriesMetric = (typeof SERIES_METRICS)[number];

/** 캔들 조회 기본/최대 개수. */
export const DEFAULT_CANDLE_LIMIT = 200;
export const MAX_CANDLE_LIMIT = 1000;

/** 시계열 윈도우 상한(분) = 7일. trade 보존 기간(TRADE_RETENTION_DAYS 기본 7일)과 맞춘다. */
export const MAX_WINDOW_MINUTES = 10_080;

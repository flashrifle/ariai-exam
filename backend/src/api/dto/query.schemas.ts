/**
 * HTTP 입력 검증 스키마 (zod).
 *
 * 모든 쿼리/바디는 여기서 정의한 스키마를 통과해야만 핸들러에 도달한다.
 * limit 류는 반드시 상한을 둔다 — 무제한 조회는 DB와 응답 크기를 동시에 망가뜨린다.
 */
import { z } from 'zod';
import {
  BASE_INTERVAL,
  SUPPORTED_INTERVALS,
  SUPPORTED_SYMBOLS,
} from '../../config/configuration';

/* ── 상한/기본값 상수 ─────────────────────────────────────────── */

export const CANDLE_LIMIT_DEFAULT = 500;
export const CANDLE_LIMIT_MAX = 1000;
export const BACKFILL_JOB_LIMIT_DEFAULT = 50;
export const BACKFILL_JOB_LIMIT_MAX = 200;
export const COLLECTOR_EVENT_LIMIT_DEFAULT = 100;
export const COLLECTOR_EVENT_LIMIT_MAX = 500;
/** 수동 백필 1회 요청의 최대 구간 (31일). 무한 백필로 레이트리밋을 태우지 않기 위함. */
export const MANUAL_BACKFILL_MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
/** 미래 시각 허용 오차 (시계 오차 흡수용). */
export const FUTURE_SKEW_TOLERANCE_MS = 60_000;

/* ── 기본 조각 ────────────────────────────────────────────────── */

export const symbolSchema = z.enum(SUPPORTED_SYMBOLS);
export const intervalSchema = z.enum(SUPPORTED_INTERVALS);

const limitSchema = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

/** ISO8601 문자열 → Date. 파싱 불가면 400. */
const isoDateSchema = z
  .string()
  .refine((raw) => Number.isFinite(Date.parse(raw)), 'ISO8601 형식의 시각이어야 합니다')
  .transform((raw) => new Date(raw));

/* ── /candles ─────────────────────────────────────────────────── */

export const candlesQuerySchema = z.object({
  symbol: symbolSchema,
  interval: intervalSchema.default(BASE_INTERVAL),
  limit: limitSchema(CANDLE_LIMIT_MAX, CANDLE_LIMIT_DEFAULT),
});
export type CandlesQuery = z.infer<typeof candlesQuerySchema>;

/* ── /metrics ─────────────────────────────────────────────────── */

export const metricsOverviewQuerySchema = z.object({
  symbol: symbolSchema,
});
export type MetricsOverviewQuery = z.infer<typeof metricsOverviewQuerySchema>;

/**
 * metric 은 지표 모듈이 계속 늘려갈 수 있으므로 값 목록을 고정하지 않는다.
 * 대신 식별자 문법만 강제해 이상한 입력이 하위 계층까지 흘러가지 않게 막는다.
 */
export const metricsSeriesQuerySchema = z.object({
  symbol: symbolSchema,
  metric: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, '영문으로 시작하는 지표 식별자여야 합니다'),
  window: z
    .string()
    .regex(/^[1-9]\d{0,3}[mhd]$/, "숫자+단위(m|h|d) 형식이어야 합니다 (예: '15m', '24h')")
    .default('1h'),
});
export type MetricsSeriesQuery = z.infer<typeof metricsSeriesQuerySchema>;

/* ── /ops ─────────────────────────────────────────────────────── */

export const backfillJobsQuerySchema = z.object({
  limit: limitSchema(BACKFILL_JOB_LIMIT_MAX, BACKFILL_JOB_LIMIT_DEFAULT),
});
export type BackfillJobsQuery = z.infer<typeof backfillJobsQuerySchema>;

export const collectorEventsQuerySchema = z.object({
  limit: limitSchema(COLLECTOR_EVENT_LIMIT_MAX, COLLECTOR_EVENT_LIMIT_DEFAULT),
});
export type CollectorEventsQuery = z.infer<typeof collectorEventsQuerySchema>;

export const manualBackfillBodySchema = z
  .object({
    symbol: symbolSchema,
    interval: intervalSchema,
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((body) => body.from.getTime() < body.to.getTime(), 'from 은 to 보다 이전이어야 합니다')
  .refine(
    (body) => body.to.getTime() - body.from.getTime() <= MANUAL_BACKFILL_MAX_RANGE_MS,
    '한 번에 요청할 수 있는 구간은 최대 31일입니다',
  )
  .refine(
    (body) => body.to.getTime() <= Date.now() + FUTURE_SKEW_TOLERANCE_MS,
    'to 는 미래 시각일 수 없습니다',
  );
export type ManualBackfillBody = z.infer<typeof manualBackfillBodySchema>;

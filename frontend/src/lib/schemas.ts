/**
 * 백엔드 응답의 런타임 검증 스키마.
 *
 * `src/types/api.ts` 가 계약의 원본이고, 여기 스키마는 그 타입을 런타임에서
 * 재확인하는 역할만 한다. 각 스키마에 `satisfies z.ZodType<T>` 를 달아두었으므로
 * 계약 타입과 스키마가 어긋나면 **컴파일 단계에서** 잡힌다.
 *
 * 검증 실패를 조용히 넘기지 않는 이유: 백엔드가 동시 개발 중이라
 * 필드명 오타 · 문자열/숫자 혼동 같은 계약 위반을 개발 단계에서 잡아야 한다.
 */
import { z } from 'zod';

import type {
  ApiResponse,
  BackfillJob,
  Candle,
  CandleEvent,
  CollectorEvent,
  Interval,
  MetricPoint,
  MetricSeries,
  MetricsEvent,
  MetricsOverview,
  OpsEvent,
  OpsHealth,
  StreamHealth,
  Symbol as TradingSymbol,
  TickEvent,
} from '@/types/api';

/** ISO 8601 문자열. `Z` 와 `+09:00` 형태 모두 허용한다. */
const isoDateTime = z.iso.datetime({ offset: true });

export const symbolSchema = z.enum(['BTCUSDT', 'ETHUSDT']) satisfies z.ZodType<TradingSymbol>;
export const intervalSchema = z.enum(['1m', '5m', '15m', '1h']) satisfies z.ZodType<Interval>;

/* ── 시장 데이터 ───────────────────────────────────────────────── */

export const candleSchema = z.object({
  openTime: isoDateTime,
  closeTime: isoDateTime,
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  quoteVolume: z.number(),
  tradeCount: z.number(),
  takerBuyQuote: z.number(),
}) satisfies z.ZodType<Candle>;

export const candleListSchema = z.array(candleSchema);

export const metricsOverviewSchema = z.object({
  symbol: symbolSchema,
  asOf: isoDateTime,
  lastPrice: z.number(),
  priceChangePct24h: z.number(),
  quoteVolume24h: z.number(),
  vwap: z.number(),
  vwapDeviationPct: z.number(),
  realizedVolatility: z.number(),
  takerBuyRatio: z.number(),
  tradeCount1m: z.number(),
  volumeSurgeRatio: z.number(),
}) satisfies z.ZodType<MetricsOverview>;

export const metricPointSchema = z.object({
  ts: isoDateTime,
  value: z.number(),
}) satisfies z.ZodType<MetricPoint>;

export const metricSeriesSchema = z.object({
  symbol: symbolSchema,
  metric: z.string(),
  window: z.string(),
  points: z.array(metricPointSchema),
}) satisfies z.ZodType<MetricSeries>;

/* ── 운영 데이터 ───────────────────────────────────────────────── */

export const streamHealthSchema = z.object({
  streamKey: z.string(),
  symbol: symbolSchema,
  kind: z.enum(['kline', 'trade']),
  connected: z.boolean(),
  lastEventAt: isoDateTime.nullable(),
  lagSeconds: z.number().nullable(),
}) satisfies z.ZodType<StreamHealth>;

export const opsHealthSchema = z.object({
  serverTime: isoDateTime,
  uptimeSeconds: z.number(),
  streams: z.array(streamHealthSchema),
  coverage: z.array(
    z.object({
      symbol: symbolSchema,
      interval: intervalSchema,
      expected: z.number(),
      actual: z.number(),
      ratio: z.number(),
      missingRanges: z.array(z.object({ from: isoDateTime, to: isoDateTime })),
    }),
  ),
  backfill: z.object({
    running: z.number(),
    pending: z.number(),
    failed24h: z.number(),
    lastSucceededAt: isoDateTime.nullable(),
  }),
}) satisfies z.ZodType<OpsHealth>;

export const backfillJobSchema = z.object({
  id: z.number(),
  symbol: symbolSchema,
  interval: intervalSchema,
  rangeStart: isoDateTime,
  rangeEnd: isoDateTime,
  reason: z.enum(['bootstrap', 'gap_recovery', 'manual']),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  rowsWritten: z.number(),
  attempts: z.number(),
  error: z.string().nullable(),
  createdAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
}) satisfies z.ZodType<BackfillJob>;

export const backfillJobListSchema = z.array(backfillJobSchema);

export const collectorEventSchema = z.object({
  id: z.number(),
  ts: isoDateTime,
  level: z.enum(['info', 'warn', 'error']),
  kind: z.string(),
  stream: z.string().nullable(),
  message: z.string(),
  meta: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<CollectorEvent>;

export const collectorEventListSchema = z.array(collectorEventSchema);

/* ── SSE 페이로드 ──────────────────────────────────────────────── */

export const tickEventSchema = z.object({
  symbol: symbolSchema,
  price: z.number(),
  qty: z.number(),
  isBuyerMaker: z.boolean(),
  tradeTime: isoDateTime,
}) satisfies z.ZodType<TickEvent>;

export const candleEventSchema = z.object({
  symbol: symbolSchema,
  interval: intervalSchema,
  candle: candleSchema,
  isClosed: z.boolean(),
}) satisfies z.ZodType<CandleEvent>;

export const metricsEventSchema = z.object({
  overview: metricsOverviewSchema,
}) satisfies z.ZodType<MetricsEvent>;

export const opsEventSchema = z.object({
  health: opsHealthSchema,
}) satisfies z.ZodType<OpsEvent>;

/* ── 응답 봉투 ─────────────────────────────────────────────────── */

/** 봉투 자체만 먼저 검증한다. `data` 는 이후 개별 스키마로 좁힌다. */
export const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().nullable(),
  error: z.string().nullable(),
}) satisfies z.ZodType<ApiResponse<unknown>>;

/* ── 폼 입력 ───────────────────────────────────────────────────── */

/**
 * 수동 백필 트리거 폼. `POST /ops/backfill { symbol, interval, from, to }`.
 * 브라우저 `datetime-local` 입력은 타임존이 없는 로컬 시각 문자열이므로
 * 제출 직전에 UTC ISO 로 변환한다 (docs/CONTRACT.md 7절: 전송은 UTC).
 */
export const backfillFormSchema = z
  .object({
    symbol: symbolSchema,
    interval: intervalSchema,
    from: z.string().min(1, '시작 시각을 입력하세요'),
    to: z.string().min(1, '종료 시각을 입력하세요'),
  })
  .refine((v) => !Number.isNaN(Date.parse(v.from)), {
    path: ['from'],
    message: '시작 시각 형식이 올바르지 않습니다',
  })
  .refine((v) => !Number.isNaN(Date.parse(v.to)), {
    path: ['to'],
    message: '종료 시각 형식이 올바르지 않습니다',
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), {
    path: ['to'],
    message: '종료 시각은 시작 시각보다 뒤여야 합니다',
  })
  .refine((v) => Date.parse(v.to) <= Date.now() + 60_000, {
    path: ['to'],
    message: '미래 구간은 백필할 수 없습니다',
  });

export type BackfillFormValues = z.infer<typeof backfillFormSchema>;

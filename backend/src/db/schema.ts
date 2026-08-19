/**
 * DB 계약 (Contract) — 모든 모듈이 이 스키마를 단일 진실 공급원으로 사용한다.
 * 변경이 필요하면 반드시 팀 리더 합의 후 마이그레이션과 함께 수정할 것.
 */
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

/** 가격/수량은 부동소수 오차를 피하기 위해 numeric으로 저장한다 (drizzle는 string으로 반환). */
const price = (name: string) => numeric(name, { precision: 24, scale: 8 });
const amount = (name: string) => numeric(name, { precision: 32, scale: 8 });

/**
 * 1분봉. 백필(REST)과 실시간(WS)이 동일한 행을 채우며,
 * (symbol, interval, open_time) 기준 idempotent upsert 한다.
 */
export const klines = pgTable(
  'klines',
  {
    symbol: varchar('symbol', { length: 20 }).notNull(),
    interval: varchar('interval', { length: 8 }).notNull(),
    openTime: timestamp('open_time', { withTimezone: true }).notNull(),
    closeTime: timestamp('close_time', { withTimezone: true }).notNull(),
    open: price('open').notNull(),
    high: price('high').notNull(),
    low: price('low').notNull(),
    close: price('close').notNull(),
    volume: amount('volume').notNull(),
    quoteVolume: amount('quote_volume').notNull(),
    tradeCount: integer('trade_count').notNull().default(0),
    takerBuyBase: amount('taker_buy_base').notNull().default('0'),
    takerBuyQuote: amount('taker_buy_quote').notNull().default('0'),
    /** 'ws' = 실시간 스트림, 'rest' = 백필. 백필이 실시간을 덮어써도 값은 동일해야 정상. */
    source: varchar('source', { length: 8 }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.symbol, t.interval, t.openTime] }),
    index('klines_symbol_interval_open_time_desc_idx').on(t.symbol, t.interval, t.openTime.desc()),
  ],
);

/**
 * 개별 체결. trade_id가 거래소 전역 시퀀스이므로 중복 수신을 자연스럽게 제거한다.
 */
export const trades = pgTable(
  'trades',
  {
    symbol: varchar('symbol', { length: 20 }).notNull(),
    tradeId: bigint('trade_id', { mode: 'bigint' }).notNull(),
    price: price('price').notNull(),
    qty: amount('qty').notNull(),
    quoteQty: amount('quote_qty').notNull(),
    tradeTime: timestamp('trade_time', { withTimezone: true }).notNull(),
    /** true면 매수자가 maker → 시장가 매도(공격적 매도)로 해석한다. */
    isBuyerMaker: boolean('is_buyer_maker').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.symbol, t.tradeId] }),
    index('trades_symbol_trade_time_desc_idx').on(t.symbol, t.tradeTime.desc()),
  ],
);

/**
 * 스트림별 마지막 수신 지점. `/ops/health` 의 수집 지연(lag) 표시에 사용한다.
 * streamKey 예: 'kline:BTCUSDT:1m', 'trade:BTCUSDT'
 *
 * 주의: **갭 판단의 기준은 이 테이블이 아니라 `klines` 다.**
 * 이 테이블은 "받았다"를 기록하지만 `klines` 는 "저장됐다"를 뜻한다.
 * 저장이 실패하면 여기만 앞서 나갈 수 있으므로, 실제 저장된 데이터를 기준으로 판단한다.
 */
export const ingestState = pgTable('ingest_state', {
  streamKey: text('stream_key').primaryKey(),
  lastEventTime: timestamp('last_event_time', { withTimezone: true }),
  lastTradeId: bigint('last_trade_id', { mode: 'bigint' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 백필 작업 이력 — 운영 대시보드에서 복구가 실제로 돌았는지 보여주는 근거가 된다. */
export const backfillJobs = pgTable(
  'backfill_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    interval: varchar('interval', { length: 8 }).notNull(),
    rangeStart: timestamp('range_start', { withTimezone: true }).notNull(),
    rangeEnd: timestamp('range_end', { withTimezone: true }).notNull(),
    /** 'bootstrap' | 'gap_recovery' | 'manual' */
    reason: varchar('reason', { length: 16 }).notNull(),
    /** 'pending' | 'running' | 'succeeded' | 'failed' */
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    rowsWritten: integer('rows_written').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('backfill_jobs_created_at_desc_idx').on(t.createdAt.desc())],
);

/** 수집기 운영 이벤트(연결/끊김/갭탐지/레이트리밋). 대시보드의 운영 로그 패널 소스. */
export const collectorEvents = pgTable(
  'collector_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    /** 'info' | 'warn' | 'error' */
    level: varchar('level', { length: 8 }).notNull(),
    /** 'ws_open' | 'ws_close' | 'ws_error' | 'reconnect' | 'gap_detected' | 'backfill_start' | 'backfill_done' | 'backfill_failed' | 'rate_limited' */
    kind: varchar('kind', { length: 32 }).notNull(),
    stream: text('stream'),
    message: text('message').notNull(),
    meta: jsonb('meta'),
  },
  (t) => [index('collector_events_ts_desc_idx').on(t.ts.desc())],
);

export type KlineRow = typeof klines.$inferSelect;
export type KlineInsert = typeof klines.$inferInsert;
export type TradeRow = typeof trades.$inferSelect;
export type TradeInsert = typeof trades.$inferInsert;
export type IngestStateRow = typeof ingestState.$inferSelect;
export type BackfillJobRow = typeof backfillJobs.$inferSelect;
export type CollectorEventRow = typeof collectorEvents.$inferSelect;

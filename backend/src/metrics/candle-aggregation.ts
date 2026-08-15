/**
 * 캔들 인터벌 집계 — 1분봉을 원본으로 5m/15m/1h 를 순수 PostgreSQL 로 파생한다.
 *
 * 버킷: to_timestamp(floor(extract(epoch from open_time) / N) * N)
 * OHLCV 집계 규칙 (docs/METRICS.md 3절):
 *   - open  = 버킷 내 "시간순 첫" 1분봉의 open   → first_value(open) OVER (ORDER BY open_time)
 *   - close = 버킷 내 "시간순 마지막" 1분봉의 close → last_value(close) — 반드시 프레임을
 *     ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING 로 확장해야 한다.
 *     (기본 프레임은 CURRENT ROW 까지라 last_value 가 "자기 행의 close"를 돌려주는 함정이 있다)
 *   - high = max, low = min
 *   - volume · quoteVolume · tradeCount · takerBuyQuote = 합계
 * 모든 집계는 PostgreSQL numeric 연산으로 수행한다. JS 는 결과를 변환만 한다.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  BASE_INTERVAL,
  type SupportedInterval,
  type SupportedSymbol,
} from '../config/configuration';
import { INTERVAL_SECONDS } from './metrics.constants';
import { toFiniteNumber, toIsoUtc } from './metrics-math';
import type { Candle, SqlScalar } from './metrics.types';

/** 캔들 SQL 이 반환하는 원시 행. numeric → string, timestamptz → Date. */
export interface CandleRow {
  open_time: Date | string;
  close_time: Date | string;
  open: SqlScalar;
  high: SqlScalar;
  low: SqlScalar;
  close: SqlScalar;
  volume: SqlScalar;
  quote_volume: SqlScalar;
  trade_count: SqlScalar;
  taker_buy_quote: SqlScalar;
}

export function intervalToSeconds(interval: SupportedInterval): number {
  return INTERVAL_SECONDS[interval];
}

/** 인터벌에 맞는 캔들 조회 SQL. 최신 limit 개를 시간 오름차순으로 반환한다. */
export function buildCandlesQuery(
  symbol: SupportedSymbol,
  interval: SupportedInterval,
  limit: number,
): SQL {
  return interval === BASE_INTERVAL
    ? buildBaseIntervalQuery(symbol, limit)
    : buildDerivedIntervalQuery(symbol, interval, limit);
}

/** 1m 은 저장 원본을 그대로 조회한다. */
function buildBaseIntervalQuery(symbol: SupportedSymbol, limit: number): SQL {
  return sql`
    with recent as (
      select open_time, close_time, open, high, low, close,
             volume, quote_volume, trade_count, taker_buy_quote
      from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
      order by open_time desc
      limit ${limit}
    )
    select * from recent order by open_time asc
  `;
}

/** 타임스탬프 식을 N초 버킷 시작 시각으로 내림하는 SQL 표현식. */
function bucketExpr(column: SQL, seconds: number): SQL {
  return sql`to_timestamp(floor(extract(epoch from ${column}) / ${seconds}::numeric) * ${seconds}::numeric)`;
}

/** 5m/15m/1h 는 1분봉을 시간 버킷으로 묶어 SQL 에서 파생한다. */
function buildDerivedIntervalQuery(
  symbol: SupportedSymbol,
  interval: SupportedInterval,
  limit: number,
): SQL {
  const seconds = intervalToSeconds(interval);
  // 최신 limit 개 버킷(진행 중 버킷 포함)만 스캔하도록 조회 하한을 둔다.
  const lookbackSeconds = seconds * (limit + 1);
  return sql`
    with bucketed as (
      select
        ${bucketExpr(sql`open_time`, seconds)} as bucket_time,
        open_time, close_time, open, high, low, close,
        volume, quote_volume, trade_count, taker_buy_quote
      from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
        and open_time >= ${bucketExpr(sql`now()`, seconds)}
                         - make_interval(secs => ${lookbackSeconds}::int)
    ),
    edged as (
      select
        bucket_time, close_time, high, low,
        volume, quote_volume, trade_count, taker_buy_quote,
        first_value(open) over w as bucket_open,
        last_value(close) over w as bucket_close
      from bucketed
      window w as (
        partition by bucket_time
        order by open_time
        rows between unbounded preceding and unbounded following
      )
    ),
    rolled as (
      select
        bucket_time as open_time,
        max(close_time) as close_time,
        min(bucket_open) as open,   -- 버킷 내 모든 행에서 동일한 값. group by 통과용 집계일 뿐이다.
        max(high) as high,
        min(low) as low,
        min(bucket_close) as close, -- 버킷 내 모든 행에서 동일한 값.
        sum(volume) as volume,
        sum(quote_volume) as quote_volume,
        sum(trade_count)::int as trade_count,
        sum(taker_buy_quote) as taker_buy_quote
      from edged
      group by bucket_time
      order by bucket_time desc
      limit ${limit}
    )
    select * from rolled order by open_time asc
  `;
}

/** 원시 행 → API Candle. 숫자 변환은 이 경계에서만 수행한다. */
export function mapCandleRow(row: CandleRow): Candle {
  return {
    openTime: toIsoUtc(row.open_time),
    closeTime: toIsoUtc(row.close_time),
    open: toFiniteNumber(row.open),
    high: toFiniteNumber(row.high),
    low: toFiniteNumber(row.low),
    close: toFiniteNumber(row.close),
    volume: toFiniteNumber(row.volume),
    quoteVolume: toFiniteNumber(row.quote_volume),
    tradeCount: toFiniteNumber(row.trade_count),
    takerBuyQuote: toFiniteNumber(row.taker_buy_quote),
  };
}

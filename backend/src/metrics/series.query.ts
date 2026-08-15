/**
 * 지표 시계열 SQL — 1분봉 기준 1분 단위 포인트를 반환한다.
 *
 * 지원 지표: vwap, realizedVolatility, takerBuyRatio, quoteVolume.
 * 계산 불가 포인트(분모 0, 표본 부족)는 SQL 에서 NULL 로 표기하고
 * 매핑 단계(mapSeriesRows)에서 제외한다 — 0 으로 위장해 그래프를 왜곡하지 않는다.
 */
import { sql, type SQL } from 'drizzle-orm';
import { BASE_INTERVAL, type SupportedSymbol } from '../config/configuration';
import { MINUTES_PER_YEAR, ROLLING_VOL_SAMPLES, type SeriesMetric } from './metrics.constants';
import { toIsoUtc } from './metrics-math';
import type { MetricPoint, SqlScalar } from './metrics.types';

/** 시계열 SQL 이 반환하는 원시 행. */
export interface SeriesRow {
  ts: Date | string;
  value: SqlScalar;
}

/** 지표 이름에 맞는 시계열 SQL 을 만든다. */
export function buildSeriesQuery(
  symbol: SupportedSymbol,
  metric: SeriesMetric,
  windowMinutes: number,
): SQL {
  switch (metric) {
    case 'quoteVolume':
      return buildPerMinuteQuery(symbol, windowMinutes, sql`quote_volume`);
    case 'vwap':
      // 1분 구간 VWAP = 해당 분의 quote_volume / volume (거래가 없으면 계산 불가)
      return buildPerMinuteQuery(
        symbol,
        windowMinutes,
        sql`case when volume > 0 then quote_volume / volume end`,
      );
    case 'takerBuyRatio':
      return buildPerMinuteQuery(
        symbol,
        windowMinutes,
        sql`case when quote_volume > 0 then taker_buy_quote / quote_volume end`,
      );
    case 'realizedVolatility':
      return buildRollingVolQuery(symbol, windowMinutes);
  }
}

/** 1분봉 컬럼식 하나를 그대로 시계열로 뽑는 공통 쿼리. */
function buildPerMinuteQuery(
  symbol: SupportedSymbol,
  windowMinutes: number,
  valueExpr: SQL,
): SQL {
  return sql`
    select open_time as ts, ${valueExpr} as value
    from klines
    where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
      and open_time > now() - make_interval(mins => ${windowMinutes}::int)
    order by open_time asc
  `;
}

/**
 * 롤링 실현변동성 — 각 시점에서 직전 ROLLING_VOL_SAMPLES(30)분 로그수익률의
 * 표본표준편차를 연율화(×√525600×100)한 값.
 * 롤링 표본을 채우기 위해 윈도우보다 (표본 수 + 1)분 더 조회한 뒤 출력 구간만 남긴다.
 */
function buildRollingVolQuery(symbol: SupportedSymbol, windowMinutes: number): SQL {
  // 프레임 경계는 사용자 입력이 아닌 내부 상수만 raw 로 삽입한다.
  const frame = sql.raw(String(ROLLING_VOL_SAMPLES - 1));
  const fetchMinutes = windowMinutes + ROLLING_VOL_SAMPLES + 1;
  return sql`
    with base as (
      select open_time, close
      from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
        and close > 0
        and open_time > now() - make_interval(mins => ${fetchMinutes}::int)
    ),
    rets as (
      select open_time, ln(close / lag(close) over (order by open_time)) as r
      from base
    ),
    rolled as (
      select open_time,
             stddev_samp(r) over w as sd,
             count(r) over w as n
      from rets
      window w as (order by open_time rows between ${frame} preceding and current row)
    )
    select open_time as ts,
           case when n >= 2 then sd * sqrt(${MINUTES_PER_YEAR}::numeric) * 100 end as value
    from rolled
    where open_time > now() - make_interval(mins => ${windowMinutes}::int)
    order by open_time asc
  `;
}

/**
 * 원시 행 → MetricPoint[].
 * NULL(계산 불가)·NaN·Infinity 포인트는 프론트로 내보내지 않고 제외한다.
 */
export function mapSeriesRows(rows: readonly SeriesRow[]): MetricPoint[] {
  return rows.flatMap((row) => {
    if (row.value === null || row.value === undefined) return [];
    const value = typeof row.value === 'number' ? row.value : Number(row.value);
    if (!Number.isFinite(value)) return [];
    return [{ ts: toIsoUtc(row.ts), value }];
  });
}

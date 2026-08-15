/**
 * MetricsOverview 스냅샷 계산 SQL.
 *
 * 모든 합계·비율·표준편차를 PostgreSQL numeric 으로 계산하고,
 * JS 는 최종 스칼라를 Number() 로 변환만 한다 (docs/CONTRACT.md 6절).
 * 계산 불가(표본 부족·분모 0)는 SQL 에서 NULL 로 명시한 뒤
 * API 경계(mapOverviewRow)에서 0 으로 치환한다 — docs/METRICS.md 4절 정책 참조.
 */
import { sql, type SQL } from 'drizzle-orm';
import { BASE_INTERVAL, type SupportedSymbol } from '../config/configuration';
import { MINUTES_PER_YEAR } from './metrics.constants';
import { clamp01, toFiniteNumber, toIsoUtc } from './metrics-math';
import type { MetricsOverview, SqlScalar } from './metrics.types';

/** 스냅샷 SQL 이 반환하는 단일 행. */
export interface OverviewRow {
  as_of: Date | string;
  last_price: SqlScalar;
  price_change_pct_24h: SqlScalar;
  quote_volume_24h: SqlScalar;
  vwap: SqlScalar;
  vwap_deviation_pct: SqlScalar;
  realized_volatility: SqlScalar;
  taker_buy_ratio: SqlScalar;
  trade_count_1m: SqlScalar;
  volume_surge_ratio: SqlScalar;
}

/** 심볼 1개의 overview 를 한 번의 왕복으로 계산하는 SQL. */
export function buildOverviewQuery(symbol: SupportedSymbol, windowMinutes: number): SQL {
  return sql`with ${priceCtes(symbol)}, ${flowCtes(symbol, windowMinutes)} ${overviewProjection()}`;
}

/** 가격 관련 CTE — 최신 체결가, 24시간 전 기준 종가. */
function priceCtes(symbol: SupportedSymbol): SQL {
  return sql`
    last_trade as (
      select price from trades
      where symbol = ${symbol}
      order by trade_time desc, trade_id desc
      limit 1
    ),
    last_kline as (
      select close from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
      order by open_time desc
      limit 1
    ),
    last_price as (
      -- 최신 체결가. 체결이 아직 없으면 마지막 1분봉 종가로 대체한다.
      select coalesce((select price from last_trade), (select close from last_kline)) as price
    ),
    base_24h as (
      -- 24시간 전 시점(이전 포함)에서 가장 가까운 1분봉의 종가
      select close from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
        and open_time <= now() - interval '24 hours'
      order by open_time desc
      limit 1
    )
  `;
}

/** 흐름(거래량·수익률) 관련 CTE — 롤링 윈도우 합계, 로그수익률 표준편차, 1분 체결 수. */
function flowCtes(symbol: SupportedSymbol, windowMinutes: number): SQL {
  return sql`
    qv_24h as (
      select coalesce(sum(quote_volume), 0) as qv
      from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
        and open_time > now() - interval '24 hours'
    ),
    win as (
      -- 최근 N분 롤링 윈도우 합계 (VWAP·체결강도·급증 비율의 분자)
      select coalesce(sum(quote_volume), 0) as qv,
             coalesce(sum(volume), 0) as v,
             coalesce(sum(taker_buy_quote), 0) as tbq
      from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
        and open_time > now() - make_interval(mins => ${windowMinutes}::int)
    ),
    prev_win as (
      -- 직전 동일 길이 구간 (급증 비율의 분모)
      select coalesce(sum(quote_volume), 0) as qv
      from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
        and open_time > now() - make_interval(mins => ${windowMinutes * 2}::int)
        and open_time <= now() - make_interval(mins => ${windowMinutes}::int)
    ),
    rets as (
      -- 1분 로그수익률. close > 0 필터로 ln(0)·0 나눗셈을 방어한다.
      -- 윈도우 첫 봉의 lag 짝을 확보하기 위해 1분 여유를 두고 조회한다.
      select ln(close / lag(close) over (order by open_time)) as r
      from klines
      where symbol = ${symbol} and "interval" = ${BASE_INTERVAL}
        and close > 0
        and open_time > now() - make_interval(mins => ${windowMinutes + 1}::int)
    ),
    vol as (
      select stddev_samp(r) as sd, count(r) as n from rets where r is not null
    ),
    t_1m as (
      select count(*) as cnt from trades
      where symbol = ${symbol} and trade_time > now() - interval '1 minute'
    )
  `;
}

/** 최종 프로젝션 — 계산 불가 조건은 CASE 로 명시해 NULL 을 반환한다. */
function overviewProjection(): SQL {
  return sql`
    select
      now() as as_of,
      (select price from last_price) as last_price,
      case when (select close from base_24h) > 0
                and (select price from last_price) is not null
           then ((select price from last_price) / (select close from base_24h) - 1) * 100
      end as price_change_pct_24h,
      (select qv from qv_24h) as quote_volume_24h,
      case when (select v from win) > 0
           then (select qv from win) / (select v from win)
      end as vwap,
      -- (last / vwap - 1) * 100 = (last * v / qv - 1) * 100 : 중첩 나눗셈을 피한 동치식
      case when (select v from win) > 0 and (select qv from win) > 0
                and (select price from last_price) is not null
           then ((select price from last_price) * (select v from win) / (select qv from win) - 1) * 100
      end as vwap_deviation_pct,
      case when (select n from vol) >= 2
           then (select sd from vol) * sqrt(${MINUTES_PER_YEAR}::numeric) * 100
      end as realized_volatility,
      case when (select qv from win) > 0
           then (select tbq from win) / (select qv from win)
      end as taker_buy_ratio,
      (select cnt from t_1m) as trade_count_1m,
      case when (select qv from prev_win) > 0
           then (select qv from win) / (select qv from prev_win)
      end as volume_surge_ratio
  `;
}

/**
 * 원시 행 → MetricsOverview. 숫자 변환·NaN/Infinity 차단은 이 경계에서만 수행한다.
 * SQL 이 NULL(계산 불가)을 준 필드는 0 으로 치환한다 — 의미는 docs/METRICS.md 4절.
 */
export function mapOverviewRow(symbol: SupportedSymbol, row: OverviewRow): MetricsOverview {
  return {
    symbol,
    asOf: toIsoUtc(row.as_of),
    lastPrice: toFiniteNumber(row.last_price),
    priceChangePct24h: toFiniteNumber(row.price_change_pct_24h),
    quoteVolume24h: toFiniteNumber(row.quote_volume_24h),
    vwap: toFiniteNumber(row.vwap),
    vwapDeviationPct: toFiniteNumber(row.vwap_deviation_pct),
    realizedVolatility: toFiniteNumber(row.realized_volatility),
    takerBuyRatio: clamp01(toFiniteNumber(row.taker_buy_ratio)),
    tradeCount1m: toFiniteNumber(row.trade_count_1m),
    volumeSurgeRatio: toFiniteNumber(row.volume_surge_ratio),
  };
}

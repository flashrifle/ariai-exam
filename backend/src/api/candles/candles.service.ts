import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.tokens';
import type { Database } from '../../db/db.tokens';
import { BASE_INTERVAL } from '../../config/configuration';
import type { SupportedInterval } from '../../config/configuration';
import { toIsoString, toNumber } from '../../common/coerce.util';
import { extractRows } from '../../common/sql.util';
import type { SqlRow } from '../../common/sql.util';
import type { Candle } from '../dto/api-types';
import type { CandlesQuery } from '../dto/query.schemas';

/**
 * 요청 인터벌 → PostgreSQL interval 리터럴.
 * **화이트리스트로만 매핑한다** — 사용자 입력이 interval 문자열로 그대로 들어가면 안 된다.
 */
const PG_INTERVAL: Record<SupportedInterval, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
};

/**
 * 캔들 조회.
 *
 * 저장 단위는 1분봉 하나뿐이고(docs/CONTRACT.md 2절), 그 이상 인터벌은 `date_bin` 으로
 * SQL 집계해 파생한다. 합계는 전부 numeric 연산으로 처리해 JS 부동소수 누적을 피한다(6절).
 */
@Injectable()
export class CandlesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findCandles(query: CandlesQuery): Promise<Candle[]> {
    const rows =
      query.interval === BASE_INTERVAL
        ? await this.selectBaseCandles(query)
        : await this.selectAggregatedCandles(query);
    return rows.map(mapCandleRow);
  }

  /** 1분봉: 최신 N개를 인덱스 역순으로 뽑은 뒤 오름차순으로 되돌린다. */
  private async selectBaseCandles(query: CandlesQuery): Promise<SqlRow[]> {
    const result = await this.db.execute(sql`
      SELECT open_time, close_time, open, high, low, close,
             volume, quote_volume, trade_count, taker_buy_quote
      FROM (
        SELECT open_time, close_time, open, high, low, close,
               volume, quote_volume, trade_count, taker_buy_quote
        FROM klines
        WHERE symbol = ${query.symbol} AND interval = ${BASE_INTERVAL}
        ORDER BY open_time DESC
        LIMIT ${query.limit}
      ) latest
      ORDER BY open_time ASC
    `);
    return extractRows(result);
  }

  /**
   * 5m/15m/1h: 1분봉을 date_bin 으로 버킷팅해 파생한다.
   * 최신 봉 기준 limit 개 버킷만 스캔하도록 범위를 좁혀 풀스캔을 막는다.
   */
  private async selectAggregatedCandles(query: CandlesQuery): Promise<SqlRow[]> {
    const bucket = PG_INTERVAL[query.interval];
    const result = await this.db.execute(sql`
      WITH bounds AS (
        SELECT date_bin(${bucket}::interval, max(open_time), TIMESTAMPTZ 'epoch') AS last_bucket
        FROM klines
        WHERE symbol = ${query.symbol} AND interval = ${BASE_INTERVAL}
      ),
      src AS (
        SELECT date_bin(${bucket}::interval, k.open_time, TIMESTAMPTZ 'epoch') AS bucket,
               k.open_time, k.close_time, k.open, k.high, k.low, k.close,
               k.volume, k.quote_volume, k.trade_count, k.taker_buy_quote
        FROM klines k
        CROSS JOIN bounds b
        WHERE k.symbol = ${query.symbol}
          AND k.interval = ${BASE_INTERVAL}
          AND b.last_bucket IS NOT NULL
          AND k.open_time >= b.last_bucket
                             - ((${query.limit}::int - 1)::double precision * ${bucket}::interval)
      )
      SELECT bucket AS open_time,
             max(close_time) AS close_time,
             (array_agg(open ORDER BY open_time ASC))[1] AS open,
             max(high) AS high,
             min(low) AS low,
             (array_agg(close ORDER BY open_time DESC))[1] AS close,
             sum(volume) AS volume,
             sum(quote_volume) AS quote_volume,
             sum(trade_count)::int AS trade_count,
             sum(taker_buy_quote) AS taker_buy_quote
      FROM src
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    return extractRows(result);
  }
}

/** SQL 행 → 프론트 계약(Candle). numeric(string) 은 여기서만 number 로 바꾼다. */
export function mapCandleRow(row: SqlRow): Candle {
  return {
    openTime: toIsoString(row.open_time),
    closeTime: toIsoString(row.close_time),
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    volume: toNumber(row.volume),
    quoteVolume: toNumber(row.quote_volume),
    tradeCount: toNumber(row.trade_count),
    takerBuyQuote: toNumber(row.taker_buy_quote),
  };
}

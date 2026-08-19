/**
 * 1분봉 리포지토리. 계약 §4.1 의 KlineRepository 구현체.
 * 백필(rest)과 실시간(ws)이 모두 이 클래스를 통해서만 캔들을 기록한다.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, gte, lte, sql } from 'drizzle-orm';
import { calcChunkSize, chunkRows } from '../chunk';
import { DRIZZLE, type Database } from '../db.tokens';
import { dedupeBy } from '../dedupe';
import { assertValidKlines, klineConflictKey, pickMoreCompleteKline } from '../kline-rules';
import { klines, type KlineInsert, type KlineRow } from '../schema';

/** klines는 컬럼이 15개라 한 번에 4000행 남짓이 파라미터 상한이다. */
const KLINE_COLUMN_COUNT = Object.keys(getTableColumns(klines)).length;
const KLINE_CHUNK_SIZE = calcChunkSize(KLINE_COLUMN_COUNT);

@Injectable()
export class KlineRepository {
  private readonly logger = new Logger(KlineRepository.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * (symbol, interval, open_time) 기준 idempotent upsert.
   *
   * 덮어쓰기 조건을 `setWhere` 로 걸어, 이미 저장된 확정 봉이 진행 중인(불완전한) 봉으로
   * 되돌아가는 것을 DB 레벨에서 막는다. 자세한 근거는 kline-rules.ts 주석 참고.
   *
   * @returns 실제로 삽입되거나 갱신된 행 수 (조건에 걸려 무시된 행은 세지 않는다)
   */
  async upsertMany(rows: KlineInsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    assertValidKlines(rows);

    // 같은 문장 안에 동일 충돌 키가 두 번 들어가면 PostgreSQL이 문장 전체를 실패시킨다.
    const deduped = dedupeBy(rows, klineConflictKey, pickMoreCompleteKline);

    let affected = 0;
    for (const chunk of chunkRows(deduped, KLINE_CHUNK_SIZE)) {
      const result = await this.db
        .insert(klines)
        .values(chunk)
        .onConflictDoUpdate({
          target: [klines.symbol, klines.interval, klines.openTime],
          set: {
            closeTime: sql`excluded.close_time`,
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            quoteVolume: sql`excluded.quote_volume`,
            tradeCount: sql`excluded.trade_count`,
            takerBuyBase: sql`excluded.taker_buy_base`,
            takerBuyQuote: sql`excluded.taker_buy_quote`,
            source: sql`excluded.source`,
            ingestedAt: sql`now()`,
          },
          // 체결 건수·거래량은 봉이 채워지는 동안 단조 증가한다.
          // 더 작은 값이 들어오면 그건 뒤늦게 도착한 진행 중 스냅샷이므로 무시한다.
          setWhere: sql`excluded.trade_count >= ${klines.tradeCount} and excluded.volume >= ${klines.volume}`,
        });

      affected += result.rowCount ?? 0;
    }

    if (deduped.length !== rows.length) {
      this.logger.debug(
        `캔들 배치 내부 중복 ${rows.length - deduped.length}건을 접었습니다 (입력 ${rows.length} → ${deduped.length})`,
      );
    }

    return affected;
  }

  /**
   * 지정 구간 `[from, to]`(양끝 포함)에서 실제로 존재하는 open_time 목록.
   * 갭 계산 전용이라 open_time 컬럼만 오름차순으로 돌려준다.
   */
  async findExistingOpenTimes(
    symbol: string,
    interval: string,
    from: Date,
    to: Date,
  ): Promise<Date[]> {
    const rows = await this.db
      .select({ openTime: klines.openTime })
      .from(klines)
      .where(
        and(
          eq(klines.symbol, symbol),
          eq(klines.interval, interval),
          gte(klines.openTime, from),
          lte(klines.openTime, to),
        ),
      )
      .orderBy(asc(klines.openTime));

    return rows.map((row) => row.openTime);
  }

  /** 가장 최근 캔들의 open_time. 한 건도 없으면 null (부트스트랩 백필 판단 기준). */
  async latestOpenTime(symbol: string, interval: string): Promise<Date | null> {
    const rows = await this.db
      .select({ openTime: klines.openTime })
      .from(klines)
      .where(and(eq(klines.symbol, symbol), eq(klines.interval, interval)))
      .orderBy(desc(klines.openTime))
      .limit(1);

    return rows[0]?.openTime ?? null;
  }

  /**
   * 심볼별 가장 오래된 1분봉 open_time. 한 건도 없으면 null.
   *
   * 기동 백필 판단에 쓴다. `latestOpenTime` 만 보면 실시간 WS 가 방금 저장한 현재 봉 때문에
   * "데이터가 있다 = 과거가 채워졌다"로 오판해 최초 백필을 건너뛴다.
   */
  async earliestOpenTime(symbol: string, interval: string): Promise<Date | null> {
    const rows = await this.db
      .select({ openTime: klines.openTime })
      .from(klines)
      .where(and(eq(klines.symbol, symbol), eq(klines.interval, interval)))
      .orderBy(asc(klines.openTime))
      .limit(1);

    return rows[0]?.openTime ?? null;
  }

  /** 구간 `[from, to]`(양끝 포함)의 캔들을 open_time 오름차순으로 조회한다. */
  async findRange(
    symbol: string,
    interval: string,
    from: Date,
    to: Date,
    limit?: number,
  ): Promise<KlineRow[]> {
    const query = this.db
      .select()
      .from(klines)
      .where(
        and(
          eq(klines.symbol, symbol),
          eq(klines.interval, interval),
          gte(klines.openTime, from),
          lte(klines.openTime, to),
        ),
      )
      .orderBy(asc(klines.openTime));

    if (limit === undefined) {
      return await query;
    }
    return await query.limit(limit);
  }

  /**
   * 최근 N개 캔들. 내부적으로는 내림차순으로 훑고(인덱스 활용) 오름차순으로 뒤집어 반환한다.
   * 차트가 바로 쓸 수 있도록 항상 시간 오름차순이다.
   */
  async findLatest(symbol: string, interval: string, limit: number): Promise<KlineRow[]> {
    if (limit <= 0) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(klines)
      .where(and(eq(klines.symbol, symbol), eq(klines.interval, interval)))
      .orderBy(desc(klines.openTime))
      .limit(limit);

    return rows.slice().reverse();
  }
}

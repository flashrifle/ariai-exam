/**
 * 개별 체결 리포지토리. 계약 §4.1 의 TradeRepository 구현체.
 * trade_id가 거래소 전역 시퀀스이므로 중복 수신은 DO NOTHING으로 자연스럽게 흡수된다.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, gte, lt, lte } from 'drizzle-orm';
import { calcChunkSize, chunkRows } from '../chunk';
import { DRIZZLE, type Database } from '../db.tokens';
import { dedupeBy, joinKey } from '../dedupe';
import { trades, type TradeInsert, type TradeRow } from '../schema';

/** trades는 컬럼이 8개라 한 번에 8000행 남짓이 파라미터 상한이다. */
const TRADE_COLUMN_COUNT = Object.keys(getTableColumns(trades)).length;
const TRADE_CHUNK_SIZE = calcChunkSize(TRADE_COLUMN_COUNT);

/** upsert 충돌 키 = 기본키 (symbol, trade_id). */
function tradeConflictKey(row: TradeInsert): string {
  return joinKey(row.symbol, row.tradeId);
}

@Injectable()
export class TradeRepository {
  private readonly logger = new Logger(TradeRepository.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * (symbol, trade_id) 충돌은 무시하고 삽입한다.
   * 체결은 사후에 값이 바뀌지 않으므로 갱신할 이유가 없다.
   *
   * @returns 실제로 새로 삽입된 행 수 (중복이라 건너뛴 행은 세지 않는다)
   */
  async insertManyIgnoreConflict(rows: TradeInsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    // 배치 안의 중복은 어차피 DB가 걸러내지만, 미리 접으면 파라미터와 왕복 비용을 아낀다.
    const deduped = dedupeBy(rows, tradeConflictKey);

    let inserted = 0;
    for (const chunk of chunkRows(deduped, TRADE_CHUNK_SIZE)) {
      const result = await this.db
        .insert(trades)
        .values(chunk)
        .onConflictDoNothing({ target: [trades.symbol, trades.tradeId] });

      inserted += result.rowCount ?? 0;
    }

    return inserted;
  }

  /** 심볼별 최신 체결 시각. 수집 지연(lag) 계산에 쓴다. */
  async latestTradeTime(symbol: string): Promise<Date | null> {
    const rows = await this.db
      .select({ tradeTime: trades.tradeTime })
      .from(trades)
      .where(eq(trades.symbol, symbol))
      .orderBy(desc(trades.tradeTime))
      .limit(1);

    return rows[0]?.tradeTime ?? null;
  }

  /**
   * 보존정책 정리: cutoff 이전(미포함) 체결을 삭제한다.
   * 한 번에 지우는 양이 많으면 락 유지시간이 길어지므로 한산한 시간대에 돌릴 것.
   *
   * @returns 삭제된 행 수
   */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db.delete(trades).where(lt(trades.tradeTime, cutoff));
    const deleted = result.rowCount ?? 0;

    if (deleted > 0) {
      this.logger.log(`보존기간 초과 체결 ${deleted}건 삭제 (기준: ${cutoff.toISOString()})`);
    }
    return deleted;
  }

  /** 구간 `[from, to]`(양끝 포함)의 체결을 시간 오름차순으로 조회한다. */
  async findRange(symbol: string, from: Date, to: Date, limit?: number): Promise<TradeRow[]> {
    const query = this.db
      .select()
      .from(trades)
      .where(and(eq(trades.symbol, symbol), gte(trades.tradeTime, from), lte(trades.tradeTime, to)))
      .orderBy(asc(trades.tradeTime));

    if (limit === undefined) {
      return await query;
    }
    return await query.limit(limit);
  }
}

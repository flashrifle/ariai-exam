/**
 * 스트림별 수집 진행 지점 리포지토리.
 * 재시작 시 "어디부터 비었는가"를 판단하는 기준점을 읽고 쓴다.
 * streamKey 예: 'kline:BTCUSDT:1m', 'trade:BTCUSDT'
 */
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db.tokens';
import { ingestState, type IngestStateRow } from '../schema';

export interface IngestStatePatch {
  /** 마지막으로 처리한 이벤트 시각. 생략하면 기존 값을 유지한다. */
  lastEventTime?: Date | null;
  /** 마지막으로 처리한 체결 ID. 생략하면 기존 값을 유지한다. */
  lastTradeId?: bigint | null;
}

@Injectable()
export class IngestStateRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 진행 지점 1건 조회. 아직 기록된 적이 없으면 null. */
  async get(streamKey: string): Promise<IngestStateRow | null> {
    const rows = await this.db
      .select()
      .from(ingestState)
      .where(eq(ingestState.streamKey, streamKey))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * 진행 지점을 전진시킨다.
   *
   * `greatest()` 를 쓰는 이유가 두 가지다.
   *  1. PostgreSQL의 greatest는 NULL을 무시하므로, patch에서 생략한 필드는 기존 값이 그대로 남는다.
   *  2. 순서가 뒤바뀐 이벤트가 늦게 도착해도 진행 지점이 **뒤로 밀리지 않는다**(단조 증가).
   *
   * @returns 갱신 후의 행
   */
  async upsert(streamKey: string, patch: IngestStatePatch): Promise<IngestStateRow> {
    const rows = await this.db
      .insert(ingestState)
      .values({
        streamKey,
        lastEventTime: patch.lastEventTime ?? null,
        lastTradeId: patch.lastTradeId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: ingestState.streamKey,
        set: {
          lastEventTime: sql`greatest(${ingestState.lastEventTime}, excluded.last_event_time)`,
          lastTradeId: sql`greatest(${ingestState.lastTradeId}, excluded.last_trade_id)`,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    const updated = rows[0];
    if (!updated) {
      // upsert는 항상 한 행을 돌려줘야 한다. 비어 있다면 스키마/쿼리가 어긋난 것이므로 감추지 않는다.
      throw new Error(`ingest_state upsert가 행을 반환하지 않았습니다 (streamKey: ${streamKey})`);
    }
    return updated;
  }

  /** 전체 진행 지점. 운영 헬스 화면이 스트림별 지연을 계산할 때 쓴다. */
  async getAll(): Promise<IngestStateRow[]> {
    return this.db.select().from(ingestState).orderBy(asc(ingestState.streamKey));
  }
}

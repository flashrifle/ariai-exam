/**
 * ingest_state 배치 갱신 스토어.
 *
 * 이벤트 매 건마다 DB를 때리지 않도록 dirty 상태를 메모리에 모았다가
 * flush 시점에 한 번의 upsert로 기록한다. 값은 단조 증가하므로
 * 더 새로운 값만 유지하며, flush 실패 시 dirty를 유지해 다음에 재시도한다.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../db/db.tokens';
import { ingestState } from '../db/schema';

interface PendingState {
  lastEventTime: Date | null;
  lastTradeId: bigint | null;
}

export class IngestStateStore {
  /** streamKey → 아직 DB에 반영하지 않은 최신 상태. */
  private readonly dirty = new Map<string, PendingState>();

  constructor(private readonly db: Database) {}

  /** kline 스트림 수신 기록 (lastEventTime만 갱신). */
  markKline(streamKey: string, eventTime: Date): void {
    const prev = this.dirty.get(streamKey);
    if (prev?.lastEventTime && eventTime <= prev.lastEventTime) {
      return;
    }
    this.dirty.set(streamKey, {
      lastEventTime: eventTime,
      lastTradeId: prev?.lastTradeId ?? null,
    });
  }

  /** trade 스트림 수신 기록 (lastTradeId + lastEventTime 갱신). */
  markTrade(streamKey: string, eventTime: Date, tradeId: bigint): void {
    const prev = this.dirty.get(streamKey);
    const prevEventTime = prev?.lastEventTime ?? null;
    const prevTradeId = prev?.lastTradeId ?? null;
    this.dirty.set(streamKey, {
      lastEventTime: prevEventTime && prevEventTime > eventTime ? prevEventTime : eventTime,
      lastTradeId: prevTradeId !== null && prevTradeId > tradeId ? prevTradeId : tradeId,
    });
  }

  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /**
   * dirty 상태를 한 번의 idempotent upsert로 기록한다.
   * 성공 시 flush 도중 새로 도착한 값은 남기고 스냅샷 분만 dirty에서 제거한다.
   * 실패 시 예외를 던지며 dirty는 그대로 유지된다 (다음 flush에서 재시도).
   */
  async flush(): Promise<number> {
    if (this.dirty.size === 0) {
      return 0;
    }
    const snapshot = [...this.dirty.entries()];
    const now = new Date();
    const values = snapshot.map(([streamKey, state]) => ({
      streamKey,
      lastEventTime: state.lastEventTime,
      lastTradeId: state.lastTradeId,
      updatedAt: now,
    }));
    await this.db
      .insert(ingestState)
      .values(values)
      .onConflictDoUpdate({
        target: ingestState.streamKey,
        set: {
          lastEventTime: sql`excluded.last_event_time`,
          lastTradeId: sql`excluded.last_trade_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    // mark*()는 항상 새 객체로 교체하므로, 참조가 같으면 flush 중 변경이 없었던 것
    for (const [streamKey, snapState] of snapshot) {
      if (this.dirty.get(streamKey) === snapState) {
        this.dirty.delete(streamKey);
      }
    }
    return values.length;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.tokens';
import type { Database } from '../../db/db.tokens';
import { backfillJobs, collectorEvents } from '../../db/schema';
import type { BackfillJob, CollectorEvent } from '../dto/api-types';
import { mapBackfillJobRow, mapCollectorEventRow } from './ops.mappers';

/**
 * 운영 패널 조회 (백필 이력 · 수집기 로그).
 * 두 목록 모두 최신순이며 limit 은 컨트롤러의 zod 스키마에서 이미 상한이 걸려 들어온다.
 */
@Injectable()
export class OpsQueryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listBackfillJobs(limit: number): Promise<BackfillJob[]> {
    const rows = await this.db
      .select()
      .from(backfillJobs)
      .orderBy(desc(backfillJobs.createdAt), desc(backfillJobs.id))
      .limit(limit);
    return rows.map(mapBackfillJobRow);
  }

  async listCollectorEvents(limit: number): Promise<CollectorEvent[]> {
    const rows = await this.db
      .select()
      .from(collectorEvents)
      .orderBy(desc(collectorEvents.ts), desc(collectorEvents.id))
      .limit(limit);
    return rows.map(mapCollectorEventRow);
  }

  /** 수동 백필 응답을 만들기 위해 생성된 job 행을 다시 읽는다. */
  async findBackfillJob(id: number): Promise<BackfillJob | null> {
    const rows = await this.db.select().from(backfillJobs).where(eq(backfillJobs.id, id)).limit(1);
    return rows.length > 0 ? mapBackfillJobRow(rows[0]) : null;
  }
}

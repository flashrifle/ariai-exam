/**
 * 백필 작업 이력 리포지토리.
 * 운영 대시보드에서 "복구가 실제로 돌았는지"를 보여주는 근거 데이터를 담당한다.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { count, desc, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db.tokens';
import { backfillJobs, type BackfillJobRow } from '../schema';

export type BackfillReason = 'bootstrap' | 'gap_recovery' | 'manual';
export type BackfillStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type BackfillStatusCounts = Readonly<Record<BackfillStatus, number>>;

export const BACKFILL_STATUSES: readonly BackfillStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
];

/** 에러 메시지를 DB에 넣기 전 자르는 길이. 스택 전체가 무한정 쌓이는 것을 막는다. */
const MAX_ERROR_LENGTH = 2000;

const EMPTY_COUNTS: BackfillStatusCounts = {
  pending: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
};

export interface BackfillJobCreate {
  symbol: string;
  interval: string;
  rangeStart: Date;
  rangeEnd: Date;
  reason: BackfillReason;
}

function isBackfillStatus(value: string): value is BackfillStatus {
  return (BACKFILL_STATUSES as readonly string[]).includes(value);
}

/** Error / 문자열 / 그 밖의 값을 사람이 읽을 수 있는 한 줄로 정규화한다. */
function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? ''}`.trim().slice(0, MAX_ERROR_LENGTH);
  }
  if (typeof error === 'string') {
    return error.slice(0, MAX_ERROR_LENGTH);
  }
  return String(error).slice(0, MAX_ERROR_LENGTH);
}

@Injectable()
export class BackfillJobRepository {
  private readonly logger = new Logger(BackfillJobRepository.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 작업을 pending 상태로 등록하고 생성된 행을 돌려준다(id가 필요하므로 returning 필수). */
  async create(input: BackfillJobCreate): Promise<BackfillJobRow> {
    if (input.rangeEnd.getTime() <= input.rangeStart.getTime()) {
      throw new Error(
        `백필 구간이 잘못되었습니다: ${input.rangeStart.toISOString()} ~ ${input.rangeEnd.toISOString()}`,
      );
    }

    const rows = await this.db
      .insert(backfillJobs)
      .values({
        symbol: input.symbol,
        interval: input.interval,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
        reason: input.reason,
        status: 'pending',
      })
      .returning();

    const created = rows[0];
    if (!created) {
      throw new Error('백필 작업 생성이 행을 반환하지 않았습니다');
    }
    return created;
  }

  /** 실행 시작. 재시도까지 세어야 하므로 attempts를 함께 증가시킨다. */
  async markRunning(id: number): Promise<void> {
    await this.applyStatus(id, 'running', {
      status: 'running',
      startedAt: new Date(),
      attempts: sql`${backfillJobs.attempts} + 1`,
      error: null,
    });
  }

  /** 성공 종료. 기록한 행 수를 남긴다. */
  async markSucceeded(id: number, rowsWritten: number): Promise<void> {
    await this.applyStatus(id, 'succeeded', {
      status: 'succeeded',
      rowsWritten,
      finishedAt: new Date(),
      error: null,
    });
  }

  /** 실패 종료. 원인을 반드시 남겨 운영 로그에서 추적 가능하게 한다. */
  async markFailed(id: number, error: unknown): Promise<void> {
    await this.applyStatus(id, 'failed', {
      status: 'failed',
      finishedAt: new Date(),
      error: toErrorText(error),
    });
  }

  /** 최근 작업 이력 (생성 시각 내림차순). */
  async recent(limit: number): Promise<BackfillJobRow[]> {
    if (limit <= 0) {
      return [];
    }
    return this.db
      .select()
      .from(backfillJobs)
      .orderBy(desc(backfillJobs.createdAt))
      .limit(limit);
  }

  /** 상태별 건수. 값이 없는 상태도 0으로 채워 반환하므로 호출부에서 분기가 필요 없다. */
  async countByStatus(): Promise<BackfillStatusCounts> {
    const rows = await this.db
      .select({ status: backfillJobs.status, total: count() })
      .from(backfillJobs)
      .groupBy(backfillJobs.status);

    const unknown = rows.filter((row) => !isBackfillStatus(row.status));
    if (unknown.length > 0) {
      this.logger.warn(
        `백필 상태 컬럼에 계약 밖의 값이 있습니다: ${unknown.map((row) => row.status).join(', ')}`,
      );
    }

    return rows.reduce<BackfillStatusCounts>(
      (acc, row) => (isBackfillStatus(row.status) ? { ...acc, [row.status]: row.total } : acc),
      EMPTY_COUNTS,
    );
  }

  /**
   * 상태 전이를 적용한다. 존재하지 않는 id면 조용히 넘어가지 않고 예외를 던진다.
   * (백필이 "돌았다고 기록됐는데 실제로는 아무 행도 안 바뀐" 상태를 방지)
   */
  private async applyStatus(
    id: number,
    nextStatus: BackfillStatus,
    patch: PgUpdateSetSource<typeof backfillJobs>,
  ): Promise<void> {
    const result = await this.db.update(backfillJobs).set(patch).where(eq(backfillJobs.id, id));

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`백필 작업 #${id}을(를) ${nextStatus} 로 갱신하지 못했습니다 (행 없음)`);
    }
  }
}

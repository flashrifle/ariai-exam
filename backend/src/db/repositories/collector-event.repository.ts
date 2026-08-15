/**
 * 수집기 운영 이벤트 리포지토리.
 * 대시보드 운영 로그 패널(GET /ops/events)의 데이터 소스다.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db.tokens';
import { collectorEvents, type CollectorEventRow } from '../schema';

export type CollectorLevel = 'info' | 'warn' | 'error';

/** 스키마 주석에 명시된 kind 목록. 새 종류가 필요하면 스키마 주석과 함께 갱신할 것. */
export type CollectorKind =
  | 'ws_open'
  | 'ws_close'
  | 'ws_error'
  | 'reconnect'
  | 'gap_detected'
  | 'backfill_start'
  | 'backfill_done'
  | 'backfill_failed'
  | 'rate_limited';

@Injectable()
export class CollectorEventRepository {
  private readonly logger = new Logger(CollectorEventRepository.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * 운영 이벤트 1건을 남긴다.
   *
   * 이 기록은 **부가 기능**이므로, 기록 실패 때문에 수집 파이프라인이 끊기면 안 된다.
   * 따라서 예외를 상위로 던지지 않고 애플리케이션 로거로 승격시켜 남긴다
   * (삼키는 것이 아니라 반드시 로깅한다).
   */
  async log(
    level: CollectorLevel,
    kind: CollectorKind,
    message: string,
    stream?: string | null,
    meta?: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      await this.db.insert(collectorEvents).values({
        level,
        kind,
        message,
        stream: stream ?? null,
        meta: meta ?? null,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.stack : String(error);
      this.logger.error(`운영 이벤트 기록 실패 (kind=${kind}, message=${message})`, detail);
    }
  }

  /** 최근 운영 이벤트 (시각 내림차순). */
  async recent(limit: number): Promise<CollectorEventRow[]> {
    if (limit <= 0) {
      return [];
    }
    return this.db
      .select()
      .from(collectorEvents)
      .orderBy(desc(collectorEvents.ts))
      .limit(limit);
  }
}

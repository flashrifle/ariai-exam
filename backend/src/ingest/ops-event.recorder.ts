/**
 * collector_events 기록기 — 운영 대시보드의 로그 패널 소스.
 * 기록 실패가 수집 파이프라인을 멈추면 안 되므로 예외를 전파하지 않고 로그만 남긴다.
 */
import { Logger } from '@nestjs/common';
import { describeError } from '../binance/error.util';
import type { Database } from '../db/db.tokens';
import { collectorEvents } from '../db/schema';

export type OpsEventLevel = 'info' | 'warn' | 'error';

export class OpsEventRecorder {
  private readonly logger = new Logger(OpsEventRecorder.name);

  constructor(private readonly db: Database) {}

  async record(
    level: OpsEventLevel,
    kind: string,
    stream: string | null,
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.db.insert(collectorEvents).values({
        level,
        kind,
        stream,
        message,
        meta: meta ?? null,
      });
    } catch (err) {
      this.logger.error(`운영 이벤트 기록 실패 (kind=${kind}): ${describeError(err)}`);
    }
  }
}

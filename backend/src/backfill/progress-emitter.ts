/**
 * BACKFILL_PROGRESS 이벤트 발행 헬퍼 — service 와 runner 가 공유한다.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents, type BackfillProgressPayload } from '../common/events';
import type { BackfillJobSpec, BackfillJobStatus } from './backfill.types';

export function emitBackfillProgress(
  emitter: EventEmitter2,
  job: BackfillJobSpec,
  status: BackfillJobStatus,
  rowsWritten: number,
  error?: string,
): void {
  const payload: BackfillProgressPayload = {
    jobId: job.jobId,
    symbol: job.symbol,
    interval: job.interval,
    status,
    rowsWritten,
    ...(error === undefined ? {} : { error }),
  };
  emitter.emit(AppEvents.BACKFILL_PROGRESS, payload);
}

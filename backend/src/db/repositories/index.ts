/**
 * 리포지토리 배럴.
 * 다른 모듈은 이 경로에서만 리포지토리를 import 한다 (계약 §1: db 디렉토리는 import 전용).
 */
import type { Provider } from '@nestjs/common';
import { BackfillJobRepository } from './backfill-job.repository';
import { CollectorEventRepository } from './collector-event.repository';
import { IngestStateRepository } from './ingest-state.repository';
import { KlineRepository } from './kline.repository';
import { TradeRepository } from './trade.repository';

export { BackfillJobRepository } from './backfill-job.repository';
export type {
  BackfillJobCreate,
  BackfillReason,
  BackfillStatus,
  BackfillStatusCounts,
} from './backfill-job.repository';
export { BACKFILL_STATUSES } from './backfill-job.repository';

export { CollectorEventRepository } from './collector-event.repository';
export type { CollectorKind, CollectorLevel } from './collector-event.repository';

export { IngestStateRepository } from './ingest-state.repository';
export type { IngestStatePatch } from './ingest-state.repository';

export { KlineRepository } from './kline.repository';
export { TradeRepository } from './trade.repository';

/** DbModule이 등록·노출하는 리포지토리 목록. */
export const DB_REPOSITORIES: Provider[] = [
  KlineRepository,
  TradeRepository,
  IngestStateRepository,
  BackfillJobRepository,
  CollectorEventRepository,
];

/**
 * 백필 모듈(backfill) 연동 포트.
 *
 * app.module.ts 바인딩 예:
 *   { provide: BACKFILL_PORT, useExisting: BackfillService }
 */
import type { SupportedInterval, SupportedSymbol } from '../../config/configuration';

export const BACKFILL_PORT = Symbol('BACKFILL_PORT');

export interface ManualBackfillRequest {
  symbol: SupportedSymbol;
  interval: SupportedInterval;
  from: Date;
  to: Date;
}

export interface ManualBackfillResult {
  /** backfill_jobs.id — API 는 이 id 로 행을 다시 읽어 응답 DTO를 만든다. */
  jobId: number;
}

export interface BackfillPort {
  /** 수동 백필 job 을 큐에 넣고 생성된 job id 를 돌려준다. */
  enqueueManual(request: ManualBackfillRequest): Promise<ManualBackfillResult>;
}

/**
 * 백필 모듈 내부 공용 타입.
 * 시각은 전부 UTC 기준이며, 내부 계산은 epoch milliseconds(number)로 다룬다.
 */
import type { SupportedInterval, SupportedSymbol } from '../config/configuration';

/** backfill_jobs.reason 은 DB 리포지토리 정의를 단일 진실 공급원으로 재사용한다. */
export type { BackfillReason } from '../db/repositories/backfill-job.repository';
import type { BackfillReason } from '../db/repositories/backfill-job.repository';

/** 반개구간 [startMs, endMs). 1분봉 open_time 경계에 정렬된 epoch ms. */
export interface TimeRange {
  readonly startMs: number;
  readonly endMs: number;
}

/** backfill_jobs.status / BACKFILL_PROGRESS 이벤트 status 값과 동일. */
export type BackfillJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** 수동 백필 요청 (운영 API POST /ops/backfill 에서 전달). */
export interface ManualBackfillRequest {
  readonly symbol: SupportedSymbol;
  readonly interval: SupportedInterval;
  readonly from: Date;
  readonly to: Date;
}

/** 실행 대상 job 하나 = 갭 구간 하나. */
export interface BackfillJobSpec {
  readonly jobId: number;
  readonly symbol: SupportedSymbol;
  readonly interval: SupportedInterval;
  readonly range: TimeRange;
}

/** 개별 job 실행 결과. */
export interface BackfillJobResult {
  readonly jobId: number;
  readonly range: TimeRange;
  readonly status: 'succeeded' | 'failed';
  readonly rowsWritten: number;
  readonly error?: string;
}

/** 한 윈도우 실행 요약 — 운영 API 응답 구성에 사용한다. */
export interface BackfillRunSummary {
  readonly symbol: SupportedSymbol;
  readonly interval: SupportedInterval;
  readonly reason: BackfillReason;
  /** 탐지된 갭 구간 수 (진행 중이라 건너뛴 구간 포함). */
  readonly detectedGapCount: number;
  /** 이미 진행 중이라 건너뛴 구간 수. */
  readonly skippedInFlightCount: number;
  readonly jobs: readonly BackfillJobResult[];
}

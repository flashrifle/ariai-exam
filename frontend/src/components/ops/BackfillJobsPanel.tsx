'use client';

import { Panel } from '@/components/ui/Panel';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useBackfillJobs } from '@/hooks/useOpsQueries';
import { formatDateTime, formatNumber, formatRangeDuration } from '@/lib/format';
import type { BackfillJob } from '@/types/api';

const STATUS_LABEL: Record<BackfillJob['status'], string> = {
  pending: '대기',
  running: '실행 중',
  succeeded: '성공',
  failed: '실패',
};

const STATUS_CLASS: Record<BackfillJob['status'], string> = {
  pending: 'text-fg-dim border-hairline',
  running: 'text-amber border-amber/60',
  succeeded: 'text-bull border-bull/50',
  failed: 'text-bear border-bear/60',
};

const REASON_LABEL: Record<BackfillJob['reason'], string> = {
  bootstrap: '최초 적재',
  gap_recovery: '갭 복구',
  manual: '수동',
};

/** 백필 이력. 어떤 구간을 왜 다시 채웠는지, 실패했다면 무엇 때문인지. */
export function BackfillJobsPanel() {
  const { data, error, isPending, refetch } = useBackfillJobs();

  return (
    <Panel title="백필 이력" code="OPS/BACKFILL-JOBS" bodyClassName="p-0">
      {error ? (
        <div className="p-3">
          <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /ops/backfill-jobs" />
        </div>
      ) : isPending ? (
        <div className="p-3">
          <LoadingBlock label="백필 이력" />
        </div>
      ) : data.length === 0 ? (
        <div className="p-3">
          <EmptyBlock label="백필 이력이 없습니다" hint="아직 갭이 탐지되지 않았습니다." />
        </div>
      ) : (
        <div className="scroll-shell max-h-72">
          <table className="data-table">
            <caption className="sr-only">백필 작업 이력</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">대상</th>
                <th scope="col">구간</th>
                <th scope="col">사유</th>
                <th scope="col">상태</th>
                <th scope="col" className="text-right">
                  행수
                </th>
                <th scope="col" className="text-right">
                  시도
                </th>
                <th scope="col">에러</th>
              </tr>
            </thead>
            <tbody>
              {data.map((job) => (
                <tr key={job.id}>
                  <td className="text-fg-dim">#{job.id}</td>
                  <td className="text-fg">
                    {job.symbol} · {job.interval}
                  </td>
                  <td title={`${formatDateTime(job.rangeStart)} ~ ${formatDateTime(job.rangeEnd)}`}>
                    {formatDateTime(job.rangeStart)}
                    <span className="text-fg-dim">
                      {' '}
                      +{formatRangeDuration(job.rangeStart, job.rangeEnd)}
                    </span>
                  </td>
                  <td>{REASON_LABEL[job.reason]}</td>
                  <td>
                    <span className={`label-micro border px-1.5 py-0.5 ${STATUS_CLASS[job.status]}`}>
                      {STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="text-fg text-right">{formatNumber(job.rowsWritten)}</td>
                  <td className="text-right">{job.attempts}</td>
                  <td className="text-bear max-w-56 truncate" title={job.error ?? undefined}>
                    {job.error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

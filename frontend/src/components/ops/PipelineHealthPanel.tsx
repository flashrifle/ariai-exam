'use client';

import { StatusDot } from '@/components/ui/StatusDot';
import { ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useOpsHealth } from '@/hooks/useOpsQueries';
import { useIsStreamLive } from '@/hooks/useStreamConnection';
import { formatLag, formatNumber, formatRatioPercent, formatTime, formatUptime } from '@/lib/format';
import { coverageTone, summarizeHealth } from '@/lib/ops-thresholds';

const TONE_TEXT = {
  ok: 'text-bull',
  warn: 'text-amber',
  down: 'text-bear',
  idle: 'text-fg-muted',
} as const;

const TONE_LABEL = {
  ok: '정상',
  warn: '주의',
  down: '장애',
  idle: '대기',
} as const;

/**
 * 파이프라인 건강도 헤드라인.
 *
 * 현재가 패널과 같은 위계로 크게 놓는다 — 이 대시보드는 시세 화면이 아니라
 * **수집 운영 콘솔**이므로, "지금 데이터가 온전한가" 가 "얼마인가" 만큼 중요하다.
 */
export function PipelineHealthPanel() {
  const isLive = useIsStreamLive();
  const { data, error, isPending, refetch } = useOpsHealth(isLive);

  if (error) {
    return (
      <section aria-label="파이프라인 건강도" className="panel border-hairline-strong p-4 lg:p-5">
        <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /ops/health" />
      </section>
    );
  }

  if (isPending) {
    return (
      <section aria-label="파이프라인 건강도" className="panel border-hairline-strong p-4 lg:p-5">
        <LoadingBlock label="운영 상태" />
      </section>
    );
  }

  const summary = summarizeHealth(data);
  const coverageRatio = summary.worstCoverageRatio;

  return (
    <section
      aria-label="파이프라인 건강도"
      className="panel border-hairline-strong justify-between gap-4 p-4 lg:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="num text-fg text-sm tracking-[0.18em]">PIPELINE</span>
        <StatusDot tone={summary.tone} label={TONE_LABEL[summary.tone]} />
      </div>

      <div className="flex flex-col gap-1">
        <span
          className={`num text-display font-semibold ${
            coverageRatio === null ? 'text-fg-muted' : TONE_TEXT[coverageTone(coverageRatio)]
          }`}
        >
          {coverageRatio === null ? '—' : formatRatioPercent(coverageRatio, 2)}
        </span>
        <span className="label-micro">24시간 1분봉 커버리지 (최저 심볼 기준)</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact
          label="스트림 연결"
          value={`${summary.connectedStreams} / ${summary.totalStreams}`}
          tone={summary.connectedStreams === summary.totalStreams ? 'ok' : 'down'}
        />
        <Fact label="최대 지연" value={formatLag(summary.worstLagSeconds)} code="lagSeconds" />
        <Fact
          label="누락 구간"
          value={`${formatNumber(summary.totalMissingRanges)}개`}
          tone={summary.totalMissingRanges > 0 ? 'warn' : 'ok'}
        />
        <Fact label="가동 시간" value={formatUptime(data.uptimeSeconds)} />
        <Fact
          label="백필 실행/대기"
          value={`${data.backfill.running} / ${data.backfill.pending}`}
        />
        <Fact
          label="24시간 실패"
          value={`${data.backfill.failed24h}건`}
          tone={data.backfill.failed24h > 0 ? 'warn' : 'ok'}
        />
      </dl>

      <p className="label-micro border-hairline border-t pt-2 whitespace-normal">
        서버 시각 {formatTime(data.serverTime)} · 마지막 백필 성공{' '}
        {data.backfill.lastSucceededAt ? formatTime(data.backfill.lastSucceededAt) : '없음'}
      </p>
    </section>
  );
}

function Fact({
  label,
  value,
  code,
  tone = 'idle',
}: {
  label: string;
  value: string;
  code?: string;
  tone?: keyof typeof TONE_TEXT;
}) {
  return (
    <div className="border-hairline border-t pt-2">
      <dt className="label-micro mb-1 flex items-baseline justify-between gap-2">
        <span>{label}</span>
        {code ? <span className="opacity-60">{code}</span> : null}
      </dt>
      <dd className={`num text-base ${tone === 'idle' ? 'text-fg' : TONE_TEXT[tone]}`}>{value}</dd>
    </div>
  );
}

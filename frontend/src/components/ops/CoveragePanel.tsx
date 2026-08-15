'use client';

import { Panel } from '@/components/ui/Panel';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useOpsHealth } from '@/hooks/useOpsQueries';
import { useIsStreamLive } from '@/hooks/useStreamConnection';
import { formatDateTime, formatNumber, formatRangeDuration, formatRatioPercent } from '@/lib/format';
import { coverageTone } from '@/lib/ops-thresholds';
import { useUiStore } from '@/store/ui-store';
import type { Interval, OpsHealth } from '@/types/api';

type CoverageEntry = OpsHealth['coverage'][number];

const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

/** 1분짜리 갭도 눈에 보이도록 최소 폭을 강제한다. */
const MIN_GAP_WIDTH_PERCENT = 0.45;

const TONE_TEXT = {
  ok: 'text-bull',
  warn: 'text-amber',
  down: 'text-bear',
  idle: 'text-fg-muted',
} as const;

/**
 * 커버리지 패널.
 *
 * 비율 하나로는 "어디가" 비었는지 알 수 없다. 그래서 수집 창 전체를 띠로 깔고
 * 누락 구간을 그 위에 실제 위치·길이대로 얹는다.
 */
export function CoveragePanel() {
  const isLive = useIsStreamLive();
  const { data, error, isPending, refetch } = useOpsHealth(isLive);
  const isDetailOpen = useUiStore((state) => state.isCoverageDetailOpen);
  const toggleDetail = useUiStore((state) => state.toggleCoverageDetail);

  return (
    <Panel
      title="수집 커버리지"
      code="OPS/COVERAGE"
      actions={
        <button
          type="button"
          className="seg-item border-hairline border"
          aria-pressed={isDetailOpen}
          onClick={toggleDetail}
        >
          누락 구간 {isDetailOpen ? '접기' : '펼치기'}
        </button>
      }
    >
      {error ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /ops/health" />
      ) : isPending ? (
        <LoadingBlock label="커버리지" />
      ) : data.coverage.length === 0 ? (
        <EmptyBlock
          label="커버리지 정보가 없습니다"
          hint="백엔드가 아직 커버리지를 집계하지 않았습니다."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {data.coverage.map((entry) => (
            <CoverageRow
              key={`${entry.symbol}-${entry.interval}`}
              entry={entry}
              serverTime={data.serverTime}
              isDetailOpen={isDetailOpen}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

interface CoverageRowProps {
  entry: CoverageEntry;
  serverTime: string;
  isDetailOpen: boolean;
}

function CoverageRow({ entry, serverTime, isDetailOpen }: CoverageRowProps) {
  const tone = coverageTone(entry.ratio);
  const windowMs = entry.expected * INTERVAL_MS[entry.interval];
  const endMs = Date.parse(serverTime);
  const startMs = endMs - windowMs;
  const missingCount = entry.expected - entry.actual;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="num text-fg text-sm tracking-[0.14em]">{entry.symbol}</span>
          <span className="label-micro">{entry.interval}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className={`num text-lg ${TONE_TEXT[tone]}`}>
            {formatRatioPercent(entry.ratio, 2)}
          </span>
          <span className="label-micro">
            {formatNumber(entry.actual)} / {formatNumber(entry.expected)} 봉
          </span>
        </div>
      </div>

      <CoverageTimeline
        entry={entry}
        startMs={startMs}
        endMs={endMs}
        missingCount={missingCount}
      />

      {isDetailOpen ? <MissingRangeList entry={entry} /> : null}
    </div>
  );
}

function CoverageTimeline({
  entry,
  startMs,
  endMs,
  missingCount,
}: {
  entry: CoverageEntry;
  startMs: number;
  endMs: number;
  missingCount: number;
}) {
  const spanMs = Math.max(1, endMs - startMs);

  return (
    <figure className="flex flex-col gap-1.5">
      <div
        className="border-hairline bg-bull/25 relative h-7 w-full overflow-hidden border"
        role="img"
        aria-label={`${entry.symbol} ${entry.interval} 수집 창 타임라인. 총 ${formatNumber(entry.expected)}봉 중 ${formatNumber(missingCount)}봉 누락, 누락 구간 ${entry.missingRanges.length}개.`}
      >
        {entry.missingRanges.map((range) => {
          const from = Date.parse(range.from);
          const to = Date.parse(range.to);
          if (Number.isNaN(from) || Number.isNaN(to)) return null;

          const left = ((from - startMs) / spanMs) * 100;
          const width = Math.max(((to - from) / spanMs) * 100, MIN_GAP_WIDTH_PERCENT);

          return (
            <span
              key={`${range.from}-${range.to}`}
              className="bg-bear absolute inset-y-0"
              style={{
                left: `${Math.min(99.5, Math.max(0, left))}%`,
                width: `${Math.min(100, width)}%`,
              }}
              title={`${formatDateTime(range.from)} ~ ${formatDateTime(range.to)}`}
            />
          );
        })}

        {/* 6시간 간격 눈금 */}
        {[25, 50, 75].map((position) => (
          <span
            key={position}
            className="bg-ink-950/60 absolute inset-y-0 w-px"
            style={{ left: `${position}%` }}
            aria-hidden="true"
          />
        ))}
      </div>

      <figcaption className="label-micro flex justify-between whitespace-normal">
        <span>{formatDateTime(new Date(startMs).toISOString())}</span>
        <span className={entry.missingRanges.length > 0 ? 'text-bear' : 'text-bull'}>
          {entry.missingRanges.length > 0
            ? `누락 ${formatNumber(missingCount)}봉 · 구간 ${entry.missingRanges.length}개`
            : '누락 없음'}
        </span>
        <span>{formatDateTime(new Date(endMs).toISOString())}</span>
      </figcaption>
    </figure>
  );
}

function MissingRangeList({ entry }: { entry: CoverageEntry }) {
  if (entry.missingRanges.length === 0) {
    return <p className="label-micro whitespace-normal">누락 구간 없음</p>;
  }

  return (
    <ul className="border-hairline flex flex-col gap-1 border-t pt-2">
      {entry.missingRanges.map((range) => (
        <li
          key={`${range.from}-${range.to}`}
          className="num text-fg-muted flex flex-wrap items-baseline justify-between gap-2 text-[11px]"
        >
          <span>
            {formatDateTime(range.from)} → {formatDateTime(range.to)}
          </span>
          <span className="text-bear">{formatRangeDuration(range.from, range.to)}</span>
        </li>
      ))}
    </ul>
  );
}

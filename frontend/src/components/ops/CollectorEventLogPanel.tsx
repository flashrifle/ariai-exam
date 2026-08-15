'use client';

import { Panel } from '@/components/ui/Panel';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useCollectorEvents } from '@/hooks/useOpsQueries';
import { formatDateTime } from '@/lib/format';
import { useUiStore, type EventLevelFilter } from '@/store/ui-store';
import type { CollectorEvent } from '@/types/api';

const LEVEL_OPTIONS: readonly EventLevelFilter[] = ['all', 'info', 'warn', 'error'];

const LEVEL_OPTION_LABEL: Record<EventLevelFilter, string> = {
  all: '전체',
  info: '정보',
  warn: '주의',
  error: '오류',
};

const LEVEL_MARK: Record<CollectorEvent['level'], { label: string; className: string }> = {
  info: { label: 'INFO', className: 'text-fg-dim border-hairline' },
  warn: { label: 'WARN', className: 'text-amber border-amber/60' },
  error: { label: 'ERR', className: 'text-bear border-bear/60' },
};

/** 수집기 운영 로그. 연결/끊김/갭탐지/백필이 시간순으로 쌓인다. */
export function CollectorEventLogPanel() {
  const level = useUiStore((state) => state.eventLevel);
  const setLevel = useUiStore((state) => state.setEventLevel);
  const { data, error, isPending, refetch } = useCollectorEvents();

  const events = data?.filter((event) => level === 'all' || event.level === level) ?? [];

  return (
    <Panel
      title="수집기 이벤트"
      code="OPS/EVENTS"
      bodyClassName="p-0"
      actions={
        <SegmentedControl<EventLevelFilter>
          label="로그 레벨 필터"
          options={LEVEL_OPTIONS}
          value={level}
          onChange={setLevel}
          renderLabel={(option) => LEVEL_OPTION_LABEL[option]}
        />
      }
    >
      {error ? (
        <div className="p-3">
          <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /ops/events" />
        </div>
      ) : isPending ? (
        <div className="p-3">
          <LoadingBlock label="운영 로그" />
        </div>
      ) : events.length === 0 ? (
        <div className="p-3">
          <EmptyBlock
            label="표시할 이벤트가 없습니다"
            hint={level === 'all' ? '수집기가 아직 로그를 남기지 않았습니다.' : '필터를 바꿔보세요.'}
          />
        </div>
      ) : (
        <ol className="scroll-shell max-h-72">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function EventRow({ event }: { event: CollectorEvent }) {
  const mark = LEVEL_MARK[event.level];

  return (
    <li className="border-hairline hover:bg-ink-850 flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
      <span className="num text-fg-dim w-24 shrink-0 text-[11px] leading-5">
        {formatDateTime(event.ts)}
      </span>
      <span className={`label-micro mt-0.5 shrink-0 border px-1.5 py-0.5 ${mark.className}`}>
        {mark.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-fg text-xs leading-5">{event.message}</p>
        <p className="label-micro mt-0.5 whitespace-normal">
          {event.kind}
          {event.stream ? ` · ${event.stream}` : ''}
        </p>
      </div>
    </li>
  );
}

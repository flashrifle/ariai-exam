'use client';

import { Panel } from '@/components/ui/Panel';
import { StatusDot } from '@/components/ui/StatusDot';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useOpsHealth } from '@/hooks/useOpsQueries';
import { useIsStreamLive } from '@/hooks/useStreamConnection';
import { formatLag, formatTime } from '@/lib/format';
import { LAG_CRITICAL_SECONDS, LAG_WARN_SECONDS, streamTone } from '@/lib/ops-thresholds';
import type { StreamHealth } from '@/types/api';

const KIND_LABEL: Record<StreamHealth['kind'], string> = {
  kline: '캔들',
  trade: '체결',
};

/** 스트림별 연결 상태와 지연. 지연은 파이프라인 장애의 첫 신호다. */
export function StreamHealthPanel() {
  const isLive = useIsStreamLive();
  const { data, error, isPending, refetch } = useOpsHealth(isLive);

  return (
    <Panel title="스트림 상태" code="OPS/STREAMS" bodyClassName="p-0">
      {error ? (
        <div className="p-3">
          <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /ops/health" />
        </div>
      ) : isPending ? (
        <div className="p-3">
          <LoadingBlock label="스트림 상태" />
        </div>
      ) : data.streams.length === 0 ? (
        <div className="p-3">
          <EmptyBlock
            label="등록된 스트림이 없습니다"
            hint="수집기가 아직 구독을 시작하지 않았습니다."
          />
        </div>
      ) : (
        <div className="scroll-shell max-h-64">
          <table className="data-table">
            <caption className="sr-only">
              스트림별 연결 상태와 마지막 이벤트 수신 이후 경과 시간
            </caption>
            <thead>
              <tr>
                <th scope="col">스트림</th>
                <th scope="col">종류</th>
                <th scope="col">상태</th>
                <th scope="col">마지막 수신</th>
                <th scope="col">지연</th>
              </tr>
            </thead>
            <tbody>
              {data.streams.map((stream) => (
                <StreamRow key={stream.streamKey} stream={stream} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="label-micro border-hairline border-t px-3 py-2 whitespace-normal">
        지연 {LAG_WARN_SECONDS}초 이상 주의 · {LAG_CRITICAL_SECONDS}초 이상 장애
      </p>
    </Panel>
  );
}

function StreamRow({ stream }: { stream: StreamHealth }) {
  const tone = streamTone(stream);
  const lagRatio =
    stream.lagSeconds === null ? 0 : Math.min(1, stream.lagSeconds / LAG_CRITICAL_SECONDS);

  const barColor =
    tone === 'down' ? 'bg-bear' : tone === 'warn' ? 'bg-amber' : 'bg-bull';

  return (
    <tr>
      <td className="text-fg">{stream.streamKey}</td>
      <td>{KIND_LABEL[stream.kind]}</td>
      <td>
        <StatusDot
          tone={tone}
          label={stream.connected ? '연결됨' : '끊김'}
          pulse={tone === 'ok'}
        />
      </td>
      <td>{formatTime(stream.lastEventAt)}</td>
      <td>
        <div className="flex items-center gap-2">
          <span className="w-16">{formatLag(stream.lagSeconds)}</span>
          <span className="bg-ink-800 relative block h-1.5 w-16 overflow-hidden" aria-hidden="true">
            <span
              className={`absolute inset-y-0 left-0 w-full origin-left transition-transform duration-200 ease-out ${barColor}`}
              style={{ transform: `scaleX(${lagRatio})` }}
            />
          </span>
        </div>
      </td>
    </tr>
  );
}

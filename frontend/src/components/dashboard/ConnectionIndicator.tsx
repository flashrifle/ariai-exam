'use client';

import { StatusDot } from '@/components/ui/StatusDot';
import { useStreamConnection } from '@/hooks/useStreamConnection';
import { formatRelative } from '@/lib/format';

/**
 * 실시간 연결 인디케이터.
 *
 * 1초 타이머가 돌기 때문에 **의도적으로 가장 작은 잎 컴포넌트**로 분리했다.
 * 헤더 전체가 매초 렌더되지 않게 하기 위함이다.
 */
export function ConnectionIndicator() {
  const connection = useStreamConnection();

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end gap-0.5">
        <StatusDot
          tone={connection.tone}
          label={connection.label}
          pulse={connection.status === 'live' && !connection.isStale}
        />
        <span
          className="label-micro max-w-52 truncate"
          title={connection.detail ?? undefined}
        >
          {connection.detail ?? `수신 ${formatRelative(connection.lastEventAt, connection.now)}`}
        </span>
      </div>

      {connection.invalidCount > 0 ? (
        <span
          className="label-micro text-bear border-bear/50 border px-1.5 py-1"
          title="SSE 페이로드가 계약 타입과 달라 무시된 횟수입니다. 백엔드 DTO 를 확인하세요."
        >
          계약위반 {connection.invalidCount}
        </span>
      ) : null}
    </div>
  );
}

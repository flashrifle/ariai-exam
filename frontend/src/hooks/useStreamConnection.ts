'use client';

import { useEventStreamClient, useStreamSnapshot } from '@/hooks/useEventStream';
import { useNow } from '@/hooks/useNow';
import type { StatusTone } from '@/components/ui/StatusDot';
import type { StreamStatus } from '@/lib/stream/event-stream-client';

/** 이 시간 이상 이벤트가 없으면 "연결은 살아 있지만 수신이 멈춤"으로 본다. */
const STALE_AFTER_MS = 15_000;

/**
 * 폴링 대체 여부 판단용. **타이머가 없어서** 상태가 실제로 바뀔 때만 렌더된다.
 * 트리 상단에서 써도 안전하다.
 */
export function useIsStreamLive(): boolean {
  return useStreamSnapshot().status === 'live';
}

export interface ConnectionView {
  status: StreamStatus;
  tone: StatusTone;
  /** 인디케이터에 찍히는 짧은 라벨 */
  label: string;
  /** 보조 설명 (재연결 횟수 · 마지막 오류 등) */
  detail: string | null;
  lastEventAt: number | null;
  isStale: boolean;
  invalidCount: number;
}

/**
 * 헤더 인디케이터 전용 파생 뷰.
 * 1초 타이머가 돌아가므로 **작은 잎 컴포넌트에서만** 호출할 것.
 */
export function useStreamConnection(): ConnectionView {
  const snapshot = useStreamSnapshot();
  const client = useEventStreamClient();
  const now = useNow(1_000);

  const lastEventAt = client.getLastEventAt();
  const isStale =
    snapshot.status === 'live' && lastEventAt !== null && now - lastEventAt > STALE_AFTER_MS;

  if (snapshot.status === 'live') {
    return {
      status: snapshot.status,
      tone: isStale ? 'warn' : 'ok',
      label: isStale ? '수신 지연' : 'LIVE',
      detail: isStale ? `${Math.floor((now - (lastEventAt ?? now)) / 1000)}초째 이벤트 없음` : null,
      lastEventAt,
      isStale,
      invalidCount: snapshot.invalidCount,
    };
  }

  if (snapshot.status === 'reconnecting') {
    return {
      status: snapshot.status,
      tone: 'warn',
      label: '재연결 중',
      detail: `${snapshot.attempt}회 시도 · ${snapshot.lastError ?? '원인 불명'}`,
      lastEventAt,
      isStale: false,
      invalidCount: snapshot.invalidCount,
    };
  }

  if (snapshot.status === 'connecting') {
    return {
      status: snapshot.status,
      tone: 'idle',
      label: '연결 중',
      detail: null,
      lastEventAt,
      isStale: false,
      invalidCount: snapshot.invalidCount,
    };
  }

  return {
    status: snapshot.status,
    tone: 'down',
    label: '끊김',
    detail: snapshot.lastError,
    lastEventAt,
    isStale: false,
    invalidCount: snapshot.invalidCount,
  };
}

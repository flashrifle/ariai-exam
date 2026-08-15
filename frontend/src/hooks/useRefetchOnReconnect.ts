'use client';

import { useEffect, useRef } from 'react';

import { useStreamSnapshot } from '@/hooks/useEventStream';

/**
 * 스트림이 끊겼다가 다시 붙는 순간 한 번 재조회한다.
 *
 * 캔들처럼 폴링 대체가 없는 쿼리는 끊긴 동안의 봉을 영영 못 받는다.
 * 재연결 시점이 그 구멍을 메울 유일한 신호다.
 */
export function useRefetchOnReconnect(refetch: () => void): void {
  const status = useStreamSnapshot().status;
  const wasLive = useRef(status === 'live');
  const refetchRef = useRef(refetch);

  useEffect(() => {
    refetchRef.current = refetch;
  });

  useEffect(() => {
    const isLive = status === 'live';
    if (isLive && !wasLive.current) refetchRef.current();
    wasLive.current = isLive;
  }, [status]);
}

'use client';

import { useContext, useEffect, useRef, useSyncExternalStore } from 'react';

import { EventStreamContext } from '@/components/providers/EventStreamProvider';
import type {
  EventStreamClient,
  StreamHandlers,
  StreamSnapshot,
} from '@/lib/stream/event-stream-client';

export function useEventStreamClient(): EventStreamClient {
  const client = useContext(EventStreamContext);
  if (!client) {
    throw new Error('useEventStreamClient 는 <EventStreamProvider> 안에서만 쓸 수 있습니다');
  }
  return client;
}

/** 연결 상태 스냅샷. 상태가 실제로 바뀔 때만 렌더된다. */
export function useStreamSnapshot(): StreamSnapshot {
  const client = useEventStreamClient();
  return useSyncExternalStore(client.subscribeStatus, client.getSnapshot, client.getServerSnapshot);
}

/**
 * SSE 이벤트 구독.
 *
 * 핸들러는 ref 로 넘겨 매 렌더 재구독을 막는다. 호출부에서 useCallback 을
 * 강제하지 않아도 되고, 구독은 마운트당 정확히 한 번만 일어난다.
 */
export function useEventStream(handlers: StreamHandlers): void {
  const client = useEventStreamClient();
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(
    () =>
      client.subscribe({
        onTicks: (ticks) => handlersRef.current.onTicks?.(ticks),
        onCandles: (candles) => handlersRef.current.onCandles?.(candles),
        onMetrics: (event) => handlersRef.current.onMetrics?.(event),
        onOps: (event) => handlersRef.current.onOps?.(event),
      }),
    [client],
  );
}

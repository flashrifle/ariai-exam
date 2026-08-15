'use client';

import { createContext, useEffect, useRef, type ReactNode } from 'react';

import { STREAM_URL } from '@/lib/env';
import { EventStreamClient } from '@/lib/stream/event-stream-client';
import { createStreamSource } from '@/lib/stream/source-factory';

export const EventStreamContext = createContext<EventStreamClient | null>(null);

/**
 * SSE 연결을 애플리케이션당 **하나만** 유지한다.
 * 컴포넌트마다 EventSource 를 열면 백엔드 커넥션이 화면 수만큼 늘어난다.
 */
export function EventStreamProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<EventStreamClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new EventStreamClient(STREAM_URL, createStreamSource);
  }
  const client = clientRef.current;

  useEffect(() => {
    client.start();
    // 언마운트 시 반드시 닫는다. StrictMode 의 이중 실행도 stop→start 로 안전하다.
    return () => client.stop();
  }, [client]);

  return <EventStreamContext.Provider value={client}>{children}</EventStreamContext.Provider>;
}

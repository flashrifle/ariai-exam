'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { EventStreamProvider } from '@/components/providers/EventStreamProvider';
import { ApiError } from '@/lib/api/client';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 실시간 푸시가 주 경로다. 창 포커스마다 다시 긁을 이유가 없다.
        refetchOnWindowFocus: false,
        staleTime: 5_000,
        // 계약 위반(schema/envelope)은 재시도해도 결과가 같다. 네트워크만 한 번 더.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.kind !== 'network') return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
      },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  // 렌더마다 새 클라이언트가 만들어지면 캐시가 통째로 날아간다.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <EventStreamProvider>{children}</EventStreamProvider>
    </QueryClientProvider>
  );
}

'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { useEventStream } from '@/hooks/useEventStream';
import { queryKeys } from '@/lib/api/query-keys';
import type { OpsHealth } from '@/types/api';

/**
 * SSE 로 밀려온 서버 데이터를 **쿼리 캐시에 직접 써 넣는다.**
 *
 * zustand 로 복제하지 않는 이유: 서버 상태의 소유자는 하나여야 한다.
 * 여기서 setQueryData 를 하면 해당 키를 구독 중인 컴포넌트만 렌더된다
 * (이 훅을 호출한 컴포넌트 자신은 렌더되지 않는다).
 */
export function useStreamCacheSync(): void {
  const queryClient = useQueryClient();
  const lastBackfillSignature = useRef<string | null>(null);

  useEventStream({
    onMetrics: ({ overview }) => {
      queryClient.setQueryData(queryKeys.metricsOverview(overview.symbol), overview);
    },
    onOps: ({ health }) => {
      queryClient.setQueryData(queryKeys.opsHealth(), health);

      // 백필 카운터가 움직였다면 이력·로그 목록도 낡았다고 본다.
      const signature = backfillSignature(health);
      if (lastBackfillSignature.current !== null && lastBackfillSignature.current !== signature) {
        void queryClient.invalidateQueries({ queryKey: ['ops', 'backfill-jobs'] });
        void queryClient.invalidateQueries({ queryKey: ['ops', 'events'] });
      }
      lastBackfillSignature.current = signature;
    },
  });
}

function backfillSignature(health: OpsHealth): string {
  const { running, pending, failed24h, lastSucceededAt } = health.backfill;
  return `${running}/${pending}/${failed24h}/${lastSucceededAt ?? '-'}`;
}

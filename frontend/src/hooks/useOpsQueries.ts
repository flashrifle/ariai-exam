'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiGet, apiPost } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import {
  backfillJobListSchema,
  backfillJobSchema,
  collectorEventListSchema,
  opsHealthSchema,
} from '@/lib/schemas';
import type { BackfillJob, Interval, Symbol as TradingSymbol } from '@/types/api';

export const BACKFILL_JOB_LIMIT = 20;
export const COLLECTOR_EVENT_LIMIT = 50;

const FALLBACK_POLL_MS = 5_000;
const OPS_LIST_POLL_MS = 15_000;

/**
 * 수집 파이프라인 건강도. `GET /ops/health`
 *
 * @param isLive SSE `ops` 이벤트가 살아 있으면 true. true 면 폴링을 끈다.
 */
export function useOpsHealth(isLive: boolean) {
  return useQuery({
    queryKey: queryKeys.opsHealth(),
    queryFn: ({ signal }) => apiGet('/ops/health', opsHealthSchema, { signal }),
    refetchInterval: isLive ? false : FALLBACK_POLL_MS,
    staleTime: 1_000,
  });
}

/** 백필 이력. `GET /ops/backfill-jobs?limit` */
export function useBackfillJobs(limit = BACKFILL_JOB_LIMIT) {
  return useQuery({
    queryKey: queryKeys.backfillJobs(limit),
    queryFn: ({ signal }) =>
      apiGet('/ops/backfill-jobs', backfillJobListSchema, { params: { limit }, signal }),
    refetchInterval: OPS_LIST_POLL_MS,
  });
}

/** 수집기 운영 로그. `GET /ops/events?limit` */
export function useCollectorEvents(limit = COLLECTOR_EVENT_LIMIT) {
  return useQuery({
    queryKey: queryKeys.collectorEvents(limit),
    queryFn: ({ signal }) =>
      apiGet('/ops/events', collectorEventListSchema, { params: { limit }, signal }),
    refetchInterval: OPS_LIST_POLL_MS,
  });
}

export interface BackfillRequest {
  symbol: TradingSymbol;
  interval: Interval;
  /** UTC ISO 8601 */
  from: string;
  /** UTC ISO 8601 */
  to: string;
}

/**
 * 수동 백필 트리거. `POST /ops/backfill`
 *
 * 계약(docs/CONTRACT.md 5절)에 **응답 본문 타입이 명시돼 있지 않다.**
 * 그래서 봉투(success/error)만 강하게 검증하고, 본문이 `BackfillJob` 형태면
 * 잡 번호를 뽑아 사용자에게 보여준다. 아니면 성공 처리만 한다.
 */
export function useTriggerBackfill() {
  const queryClient = useQueryClient();

  return useMutation<BackfillJob | null, Error, BackfillRequest>({
    mutationFn: async (request) => {
      const raw = await apiPost('/ops/backfill', z.unknown(), request);
      const parsed = backfillJobSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
    },
  });
}

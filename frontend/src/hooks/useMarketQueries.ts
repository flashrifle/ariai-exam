'use client';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { candleListSchema, metricsOverviewSchema } from '@/lib/schemas';
import type { Interval, Symbol as TradingSymbol } from '@/types/api';

/** 차트에 적재할 기본 봉 개수. */
export const CANDLE_LIMIT = 300;

/** SSE 가 끊겼을 때만 쓰는 폴링 주기 (ms). */
const FALLBACK_POLL_MS = 5_000;

/**
 * 캔들 시계열. `GET /candles?symbol&interval&limit`
 *
 * 실시간 갱신은 SSE `candle` 이벤트가 차트 시리즈를 직접 update 하므로
 * 이 쿼리는 "초기 적재 + 인터벌 전환" 용도다. 따라서 폴링하지 않는다.
 */
export function useCandles(symbol: TradingSymbol, interval: Interval, limit = CANDLE_LIMIT) {
  return useQuery({
    queryKey: queryKeys.candles(symbol, interval, limit),
    queryFn: ({ signal }) =>
      apiGet('/candles', candleListSchema, {
        params: { symbol, interval, limit },
        signal,
      }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

/**
 * 지표 카드 스냅샷. `GET /metrics/overview?symbol`
 *
 * @param isLive SSE `metrics` 이벤트가 살아 있으면 true. true 면 폴링을 끈다.
 */
export function useMetricsOverview(symbol: TradingSymbol, isLive: boolean) {
  return useQuery({
    queryKey: queryKeys.metricsOverview(symbol),
    queryFn: ({ signal }) =>
      apiGet('/metrics/overview', metricsOverviewSchema, { params: { symbol }, signal }),
    refetchInterval: isLive ? false : FALLBACK_POLL_MS,
    staleTime: 1_000,
  });
}

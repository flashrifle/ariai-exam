import type { Interval, Symbol as TradingSymbol } from '@/types/api';

/**
 * TanStack Query 키. 서버 상태의 유일한 저장소는 쿼리 캐시이며,
 * zustand 에는 절대 복제하지 않는다.
 */
export const queryKeys = {
  candles: (symbol: TradingSymbol, interval: Interval, limit: number) =>
    ['candles', symbol, interval, limit] as const,
  metricsOverview: (symbol: TradingSymbol) => ['metrics', 'overview', symbol] as const,
  opsHealth: () => ['ops', 'health'] as const,
  backfillJobs: (limit: number) => ['ops', 'backfill-jobs', limit] as const,
  collectorEvents: (limit: number) => ['ops', 'events', limit] as const,
} as const;

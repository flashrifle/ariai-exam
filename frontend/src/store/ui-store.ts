'use client';

import { create } from 'zustand';

import type { Interval, Symbol as TradingSymbol } from '@/types/api';

export type EventLevelFilter = 'all' | 'info' | 'warn' | 'error';

/**
 * **UI 상태 전용** 스토어.
 *
 * 서버 데이터(캔들 · 지표 · 운영 상태)는 절대 여기 들어오지 않는다.
 * 그건 TanStack Query 캐시가 유일한 소유자다. 여기 있는 건
 * "사용자가 지금 무엇을 보고 있는가" 뿐이다.
 */
interface UiState {
  symbol: TradingSymbol;
  interval: Interval;
  /** 운영 로그 레벨 필터 */
  eventLevel: EventLevelFilter;
  /** 커버리지 누락 구간 상세 펼침 */
  isCoverageDetailOpen: boolean;
  setSymbol: (symbol: TradingSymbol) => void;
  setInterval: (interval: Interval) => void;
  setEventLevel: (level: EventLevelFilter) => void;
  toggleCoverageDetail: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  symbol: 'BTCUSDT',
  interval: '1m',
  eventLevel: 'all',
  isCoverageDetailOpen: false,
  setSymbol: (symbol) => set({ symbol }),
  setInterval: (interval) => set({ interval }),
  setEventLevel: (eventLevel) => set({ eventLevel }),
  toggleCoverageDetail: () =>
    set((state) => ({ isCoverageDetailOpen: !state.isCoverageDetailOpen })),
}));

export const SYMBOLS: readonly TradingSymbol[] = ['BTCUSDT', 'ETHUSDT'];
export const INTERVALS: readonly Interval[] = ['1m', '5m', '15m', '1h'];

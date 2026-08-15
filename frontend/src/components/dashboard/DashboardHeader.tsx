'use client';

import { ConnectionIndicator } from '@/components/dashboard/ConnectionIndicator';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useMetricsOverview } from '@/hooks/useMarketQueries';
import { useIsStreamLive } from '@/hooks/useStreamConnection';
import { useNow } from '@/hooks/useNow';
import { formatRelative, formatTime } from '@/lib/format';
import { SYMBOLS, useUiStore } from '@/store/ui-store';
import type { Symbol as TradingSymbol } from '@/types/api';

/** 화면 최상단 고정 바. 심볼 전환 · 연결 상태 · 마지막 갱신 시각. */
export function DashboardHeader() {
  const symbol = useUiStore((state) => state.symbol);
  const setSymbol = useUiStore((state) => state.setSymbol);

  return (
    <header className="border-hairline bg-ink-950/95 sticky top-0 z-20 border-b backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="bg-amber inline-block size-2.5 translate-y-[1px]" aria-hidden="true" />
          <h1 className="text-fg text-sm font-semibold tracking-[0.22em] uppercase">ARIAI</h1>
          <span className="label-micro hidden sm:inline">Binance 수집 운영 콘솔</span>
        </div>

        <div className="bg-hairline hidden h-8 w-px lg:block" aria-hidden="true" />

        <SegmentedControl<TradingSymbol>
          label="심볼 선택"
          options={SYMBOLS}
          value={symbol}
          onChange={setSymbol}
        />

        <div className="ml-auto flex items-center gap-5">
          <LastUpdated />
          <ConnectionIndicator />
        </div>
      </div>
    </header>
  );
}

/**
 * 지표 스냅샷의 서버 기준 시각(`asOf`)과 클라이언트가 실제로 반영한 시각을 함께 보여준다.
 * 둘이 벌어지면 파이프라인이 밀리고 있다는 뜻이다.
 */
function LastUpdated() {
  const symbol = useUiStore((state) => state.symbol);
  const isLive = useIsStreamLive();
  const { data, dataUpdatedAt, isFetching } = useMetricsOverview(symbol, isLive);
  const now = useNow(1_000);

  return (
    <div className="hidden flex-col items-end gap-0.5 md:flex">
      <span className="label-micro">마지막 갱신</span>
      <span className="num text-fg-muted text-xs">
        {data ? formatTime(data.asOf) : '—'}
        <span className="text-fg-dim ml-1.5">
          {dataUpdatedAt > 0 ? formatRelative(dataUpdatedAt, now) : isFetching ? '요청 중' : ''}
        </span>
      </span>
    </div>
  );
}

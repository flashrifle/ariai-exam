'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { useCandleChart } from '@/components/chart/useCandleChart';
import { Panel } from '@/components/ui/Panel';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useEventStream } from '@/hooks/useEventStream';
import { useCandles } from '@/hooks/useMarketQueries';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useRefetchOnReconnect } from '@/hooks/useRefetchOnReconnect';
import { formatPrice } from '@/lib/format';
import { INTERVALS, useUiStore } from '@/store/ui-store';
import type { Interval } from '@/types/api';

/**
 * 캔들 + 거래량 차트.
 *
 * 초기 적재는 `GET /candles`, 실시간 갱신은 SSE `candle` 이벤트다.
 * 실시간 갱신 경로는 React state 를 거치지 않고 시리즈 API 를 직접 호출한다.
 */
export function PriceChartPanel() {
  const symbol = useUiStore((state) => state.symbol);
  const interval = useUiStore((state) => state.interval);
  const changeInterval = useUiStore((state) => state.setInterval);

  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const { handleRef, isReady, error: chartError } = useCandleChart(containerRef, {
    reducedMotion: prefersReducedMotion,
  });

  const { data, error, isPending, refetch } = useCandles(symbol, interval);

  // 캔들 쿼리에는 폴링 대체가 없다. 스트림이 복구되는 순간 끊긴 구간을 메운다.
  useRefetchOnReconnect(() => void refetch());

  // 초기 적재 · 심볼/인터벌 전환 시 전체 교체
  useEffect(() => {
    if (!isReady || !data) return;
    handleRef.current?.setCandles(data);
  }, [isReady, data, handleRef]);

  // 실시간 갱신: 지금 보고 있는 (심볼, 인터벌) 만 반영한다.
  useEventStream({
    onCandles: (candles) => {
      for (const event of candles) {
        if (event.symbol !== symbol || event.interval !== interval) continue;
        handleRef.current?.updateCandle(event.candle);
      }
    },
  });

  const lastCandle = data?.[data.length - 1];

  return (
    <Panel
      title="가격 차트"
      code={`${symbol} · ${interval.toUpperCase()}`}
      bodyClassName="flex flex-1 flex-col p-0"
      actions={
        <SegmentedControl<Interval>
          label="캔들 인터벌 선택"
          options={INTERVALS}
          value={interval}
          onChange={changeInterval}
        />
      }
    >
      <div className="border-hairline flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b px-3 py-2">
        <Legend label="종가" value={formatPrice(lastCandle?.close)} />
        <Legend label="고가" value={formatPrice(lastCandle?.high)} />
        <Legend label="저가" value={formatPrice(lastCandle?.low)} />
        <Legend label="봉 수" value={data ? String(data.length) : '—'} />
        <span className="label-micro ml-auto">마지막 봉은 스트림으로 실시간 갱신됩니다</span>
      </div>

      <div className="relative min-h-[320px] flex-1">
        <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />

        {chartError ? (
          <Overlay>
            <ErrorBlock error={new Error(chartError)} />
          </Overlay>
        ) : error ? (
          <Overlay>
            <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /candles" />
          </Overlay>
        ) : isPending ? (
          <Overlay>
            <LoadingBlock label="캔들 시계열" />
          </Overlay>
        ) : data.length === 0 ? (
          <Overlay>
            <EmptyBlock
              label="표시할 캔들이 없습니다"
              hint="수집기가 아직 이 구간을 적재하지 않았을 수 있습니다. 운영 패널에서 커버리지를 확인하세요."
            />
          </Overlay>
        ) : null}
      </div>
    </Panel>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="bg-ink-900/92 absolute inset-0 flex items-center justify-center px-4">
      <div className="max-w-md">{children}</div>
    </div>
  );
}

function Legend({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="label-micro">{label}</span>
      <span className="num text-fg-muted text-xs">{value}</span>
    </span>
  );
}

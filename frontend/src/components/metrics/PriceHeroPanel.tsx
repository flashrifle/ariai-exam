'use client';

import type { ReactNode } from 'react';

import { DeltaValue, directionOf } from '@/components/ui/DeltaValue';
import { FlashValue } from '@/components/ui/FlashValue';
import { ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useLivePrice } from '@/hooks/useLiveTicks';
import { useMetricsOverview } from '@/hooks/useMarketQueries';
import { useIsStreamLive } from '@/hooks/useStreamConnection';
import { formatCompact, formatPrice, formatSignedPercent } from '@/lib/format';
import { useUiStore } from '@/store/ui-store';
import type { Symbol as TradingSymbol } from '@/types/api';

/**
 * 화면에서 가장 큰 블록. 위계상 "지금 얼마인가" 가 최우선이다.
 * 가격 자체는 SSE tick 으로, 나머지는 지표 스냅샷으로 갱신된다.
 */
export function PriceHeroPanel() {
  const symbol = useUiStore((state) => state.symbol);
  const isLive = useIsStreamLive();
  const { data, error, isPending, refetch } = useMetricsOverview(symbol, isLive);

  return (
    <section
      aria-label="현재가 요약"
      className="panel border-hairline-strong justify-between gap-4 p-4 lg:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="num text-fg text-sm tracking-[0.18em]">{symbol}</span>
        <span className="label-micro">현재가 / LAST</span>
      </div>

      {error ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /metrics/overview" />
      ) : isPending ? (
        <LoadingBlock label="지표 스냅샷" />
      ) : (
        <>
          <LivePriceLine symbol={symbol} fallbackPrice={data.lastPrice} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="24시간 변화" code="priceChangePct24h">
              <DeltaValue
                direction={directionOf(data.priceChangePct24h, 0.01)}
                text={formatSignedPercent(data.priceChangePct24h)}
                className="text-lg"
              />
            </Stat>

            <Stat label="24시간 거래대금" code="quoteVolume24h">
              <span className="num text-fg text-lg">{formatCompact(data.quoteVolume24h)}</span>
              <span className="label-micro ml-1">USDT</span>
            </Stat>
          </dl>
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  code,
  children,
}: {
  label: string;
  code: string;
  children: ReactNode;
}) {
  return (
    <div className="border-hairline border-t pt-2">
      <dt className="label-micro mb-1.5 flex items-baseline justify-between gap-2">
        <span>{label}</span>
        <span className="opacity-60">{code}</span>
      </dt>
      <dd className="flex items-baseline">{children}</dd>
    </div>
  );
}

/**
 * 체결 틱 기반 실시간 가격.
 *
 * 이 컴포넌트만 초당 최대 ~8회 렌더된다. 부모(패널 전체)는 렌더되지 않는다 —
 * 그래서 일부러 잎으로 떼어냈다.
 */
function LivePriceLine({
  symbol,
  fallbackPrice,
}: {
  symbol: TradingSymbol;
  fallbackPrice: number;
}) {
  const live = useLivePrice(symbol);
  const price = live?.price ?? fallbackPrice;
  const direction = live?.direction ?? 'flat';

  const toneClass =
    direction === 'up' ? 'text-bull' : direction === 'down' ? 'text-bear' : 'text-fg';

  return (
    <div className="flex flex-col gap-1">
      <FlashValue trigger={live?.seq ?? fallbackPrice} direction={direction}>
        <span className={`num text-hero font-semibold ${toneClass}`}>{formatPrice(price)}</span>
      </FlashValue>
      <span className="label-micro">
        {live ? '체결 스트림 실시간' : '지표 스냅샷 기준 · 체결 수신 대기'}
      </span>
    </div>
  );
}

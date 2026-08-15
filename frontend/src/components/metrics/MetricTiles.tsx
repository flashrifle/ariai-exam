'use client';

import { MetricTile } from '@/components/metrics/MetricTile';
import { DeltaValue, directionOf } from '@/components/ui/DeltaValue';
import { Panel } from '@/components/ui/Panel';
import { ErrorBlock, LoadingBlock } from '@/components/ui/StateBlock';
import { useMetricsOverview } from '@/hooks/useMarketQueries';
import { useIsStreamLive } from '@/hooks/useStreamConnection';
import {
  formatMultiple,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRatioPercent,
  formatSignedPercent,
} from '@/lib/format';
import { useUiStore } from '@/store/ui-store';

/** 거래량 급증으로 볼 배수 임계값. */
const VOLUME_SURGE_THRESHOLD = 2;

/**
 * 지표 카드 열. `MetricsOverview` 의 나머지 필드를 밀도 높게 채운다.
 * 현재가 · 24시간 변화 · 거래대금은 위계상 더 큰 Hero 패널이 담당한다.
 */
export function MetricTiles() {
  const symbol = useUiStore((state) => state.symbol);
  const isLive = useIsStreamLive();
  const { data, error, isPending, refetch } = useMetricsOverview(symbol, isLive);

  if (error) {
    return (
      <Panel title="시장 지표" code="METRICS/OVERVIEW">
        <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /metrics/overview" />
      </Panel>
    );
  }

  if (isPending) {
    return (
      <Panel title="시장 지표" code="METRICS/OVERVIEW">
        <LoadingBlock label="지표 스냅샷" />
      </Panel>
    );
  }

  const deviationDirection = directionOf(data.vwapDeviationPct, 0.005);
  const isBuyDominant = data.takerBuyRatio > 0.5;
  const isSurging = data.volumeSurgeRatio >= VOLUME_SURGE_THRESHOLD;

  return (
    <Panel title="시장 지표" code="METRICS/OVERVIEW" bodyClassName="p-0">
      <div className="bg-hairline grid grid-cols-2 gap-px xl:grid-cols-3">
        <MetricTile
          label="VWAP"
          code="vwap"
          raw={data.vwap}
          value={formatPrice(data.vwap)}
          hint="거래량 가중 평균 체결가"
        />

        <MetricTile
          label="VWAP 이격도"
          code="vwapDeviationPct"
          raw={data.vwapDeviationPct}
          value={
            <DeltaValue
              direction={deviationDirection}
              text={formatSignedPercent(data.vwapDeviationPct)}
            />
          }
          hint={
            deviationDirection === 'up'
              ? '평균 체결가보다 비싸게 거래 중'
              : deviationDirection === 'down'
                ? '평균 체결가보다 싸게 거래 중'
                : '평균 체결가 부근'
          }
        />

        <MetricTile
          label="실현변동성"
          code="realizedVolatility"
          raw={data.realizedVolatility}
          value={formatPercent(data.realizedVolatility, 1)}
          hint="1분 수익률 기준 연율화"
        />

        <MetricTile
          label="체결강도"
          code="takerBuyRatio"
          raw={data.takerBuyRatio}
          tone={isBuyDominant ? 'bull' : 'bear'}
          value={
            <DeltaValue
              direction={isBuyDominant ? 'up' : 'down'}
              text={formatRatioPercent(data.takerBuyRatio, 1)}
            />
          }
          hint={isBuyDominant ? '시장가 매수 우위 (>50%)' : '시장가 매도 우위 (<50%)'}
        />

        <MetricTile
          label="체결 건수"
          code="tradeCount1m"
          raw={data.tradeCount1m}
          value={formatNumber(data.tradeCount1m)}
          hint="최근 1분 체결 건수"
        />

        <MetricTile
          label="거래량 급증"
          code="volumeSurgeRatio"
          raw={data.volumeSurgeRatio}
          tone={isSurging ? 'amber' : 'default'}
          value={formatMultiple(data.volumeSurgeRatio)}
          hint={
            isSurging
              ? `직전 구간 대비 ${VOLUME_SURGE_THRESHOLD}배 이상 · 이상 감지`
              : '직전 동일 구간 대비 거래대금 배수'
          }
        />
      </div>
    </Panel>
  );
}

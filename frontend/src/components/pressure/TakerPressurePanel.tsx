'use client';

import { useEffect, useRef, useState } from 'react';

import { Panel } from '@/components/ui/Panel';
import { ErrorBlock } from '@/components/ui/StateBlock';
import { useTickPressure } from '@/hooks/useLiveTicks';
import { useMetricsOverview } from '@/hooks/useMarketQueries';
import { useIsStreamLive } from '@/hooks/useStreamConnection';
import { formatCompact, formatNumber, formatRatioPercent } from '@/lib/format';
import { useUiStore } from '@/store/ui-store';
import type { Symbol as TradingSymbol } from '@/types/api';

/** 1초 간격으로 60개 = 최근 1분 흐름. */
const SPARK_SAMPLES = 60;

/**
 * 체결강도 시각화.
 *
 * 두 값을 나란히 놓는다:
 *  · 백엔드가 확정한 `takerBuyRatio` (지표 스냅샷)
 *  · 지금 들어오는 체결 틱으로 계산한 실시간 압력
 * 둘이 벌어지면 지표 갱신이 밀리고 있다는 뜻이라 운영 신호로도 쓰인다.
 */
export function TakerPressurePanel() {
  const symbol = useUiStore((state) => state.symbol);
  const isLive = useIsStreamLive();
  const { data, error, refetch } = useMetricsOverview(symbol, isLive);

  return (
    <Panel title="체결강도" code="TAKER BUY RATIO">
      {error ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} source="GET /metrics/overview" />
      ) : (
        <div className="flex flex-col gap-5">
          <PressureGauge
            title="확정 지표"
            hint="백엔드 집계 기준"
            ratio={data?.takerBuyRatio ?? null}
            detail={
              data
                ? `24시간 거래대금 ${formatCompact(data.quoteVolume24h)} USDT`
                : '스냅샷 수신 대기'
            }
          />
          <LivePressureMeter symbol={symbol} />
        </div>
      )}
    </Panel>
  );
}

interface PressureGaugeProps {
  title: string;
  hint: string;
  ratio: number | null;
  detail: string;
}

function PressureGauge({ title, hint, ratio, detail }: PressureGaugeProps) {
  const buyPercent = ratio === null ? 0.5 : Math.min(1, Math.max(0, ratio));
  const isBuyDominant = ratio !== null && ratio > 0.5;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-micro label-micro-strong">{title}</span>
        <span className="label-micro">{hint}</span>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="num text-bull text-lg">
          매수 {ratio === null ? '—' : formatRatioPercent(ratio, 1)}
        </span>
        <span className="num text-bear text-lg">
          {ratio === null ? '—' : formatRatioPercent(1 - ratio, 1)} 매도
        </span>
      </div>

      {/* 폭 대신 transform: scaleX 로 움직인다 (레이아웃 비용 없음). */}
      <div
        className="bg-ink-800 relative h-6 overflow-hidden"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={ratio ?? undefined}
        aria-valuetext={
          ratio === null
            ? '체결 데이터 없음'
            : `시장가 매수 비중 ${formatRatioPercent(ratio, 1)}, ${isBuyDominant ? '매수 우위' : '매도 우위'}`
        }
        aria-label={`${title} 매수/매도 압력`}
      >
        <span
          className="bg-bear absolute inset-y-0 right-0 w-full origin-right transition-transform duration-150 ease-out"
          style={{ transform: `scaleX(${1 - buyPercent})` }}
        />
        <span
          className="bg-bull absolute inset-y-0 left-0 w-full origin-left transition-transform duration-150 ease-out"
          style={{ transform: `scaleX(${buyPercent})` }}
        />
        {/* 0.5 기준선 */}
        <span className="bg-ink-950 absolute inset-y-0 left-1/2 w-0.5" aria-hidden="true" />
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="label-micro">{detail}</span>
        <span className="label-micro">기준선 50%</span>
      </div>
    </div>
  );
}

/**
 * 체결 틱 기반 실시간 압력. 이 잎만 초당 최대 ~8회 렌더된다.
 */
function LivePressureMeter({ symbol }: { symbol: TradingSymbol }) {
  const pressure = useTickPressure(symbol);

  return (
    <div className="border-hairline flex flex-col gap-3 border-t pt-4">
      <PressureGauge
        title="실시간 (최근 60초)"
        hint="체결 스트림 직접 집계"
        ratio={pressure.ratio}
        detail={
          pressure.count > 0
            ? `${formatNumber(pressure.count)}건 · 매수 ${formatCompact(pressure.buyQuote)} / 매도 ${formatCompact(pressure.sellQuote)}`
            : '체결 수신 대기'
        }
      />
      <PressureSparkline value={pressure.ratio} />
    </div>
  );
}

/**
 * 최근 1분간 실시간 압력의 추이. 1초에 한 번만 표본을 남긴다.
 * (부모는 더 자주 렌더되지만 이 SVG 의 점은 초당 1개씩만 늘어난다)
 */
function PressureSparkline({ value }: { value: number | null }) {
  const latest = useRef<number | null>(value);
  latest.current = value;
  const [history, setHistory] = useState<readonly number[]>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      const sample = latest.current;
      if (sample === null) return;
      setHistory((prev) => [...prev, sample].slice(-SPARK_SAMPLES));
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  if (history.length < 2) {
    return <p className="label-micro">추이 표본 수집 중… (1초 간격)</p>;
  }

  const points = history
    .map((ratio, index) => `${(index / (SPARK_SAMPLES - 1)) * 100},${(1 - ratio) * 100}`)
    .join(' ');

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="border-hairline bg-ink-950 h-14 w-full border"
        role="img"
        aria-label={`최근 ${history.length}초간 시장가 매수 비중 추이`}
      >
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke="currentColor"
          strokeWidth="0.6"
          strokeDasharray="2 2"
          className="text-fg-dim"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-amber"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="label-micro">
        상단 = 매수 우위 · 점선 = 50% 기준선 · 표본 {history.length}초
      </figcaption>
    </figure>
  );
}

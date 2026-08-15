'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';

import { CHART_COLORS, CHART_FONT_FAMILY } from '@/components/chart/chart-theme';
import type { Candle } from '@/types/api';

export interface CandleChartHandle {
  /** 초기 적재 · 인터벌 전환 시 전체 교체 */
  setCandles: (candles: readonly Candle[]) => void;
  /** SSE `candle` 이벤트로 마지막 봉만 갱신 */
  updateCandle: (candle: Candle) => void;
}

interface UseCandleChartResult {
  handleRef: RefObject<CandleChartHandle | null>;
  isReady: boolean;
  /** 차트 라이브러리 로드 실패 등 */
  error: string | null;
}

/** 볼륨 페인의 상대 높이. 1 인 가격 페인 대비 약 1/4. */
const VOLUME_PANE_STRETCH = 0.26;

function toChartTime(iso: string): UTCTimestamp {
  return Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;
}

function toCandleData(candle: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: toChartTime(candle.openTime),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function toVolumeData(candle: Candle): HistogramData<UTCTimestamp> {
  return {
    time: toChartTime(candle.openTime),
    value: candle.volume,
    color: candle.close >= candle.open ? CHART_COLORS.bullTransparent : CHART_COLORS.bearTransparent,
  };
}

/**
 * lightweight-charts 인스턴스의 수명주기를 감싼다.
 *
 * · 라이브러리는 **동적 import** 한다 (초기 번들에서 제외, SSR 회피).
 * · 실시간 갱신은 React state 를 거치지 않고 시리즈 API 를 직접 호출한다.
 *   봉 하나 갱신하려고 트리를 리렌더할 이유가 없다.
 */
export function useCandleChart(
  containerRef: RefObject<HTMLDivElement | null>,
  options: { reducedMotion: boolean },
): UseCandleChartResult {
  const handleRef = useRef<CandleChartHandle | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reducedMotion } = options;

  useEffect(() => {
    let disposed = false;
    let chart: IChartApi | null = null;

    void (async () => {
      let library: typeof import('lightweight-charts');
      try {
        library = await import('lightweight-charts');
      } catch {
        if (!disposed) setError('차트 라이브러리를 불러오지 못했습니다');
        return;
      }

      const container = containerRef.current;
      if (disposed || !container) return;

      chart = library.createChart(container, {
        autoSize: true,
        layout: {
          background: { type: library.ColorType.Solid, color: 'transparent' },
          textColor: CHART_COLORS.text,
          fontSize: 11,
          fontFamily: CHART_FONT_FAMILY,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: CHART_COLORS.grid },
          horzLines: { color: CHART_COLORS.grid },
        },
        crosshair: { mode: library.CrosshairMode.Normal },
        rightPriceScale: { borderColor: CHART_COLORS.grid },
        timeScale: {
          borderColor: CHART_COLORS.grid,
          timeVisible: true,
          secondsVisible: false,
        },
        // 모션 민감 사용자를 위해 관성 스크롤을 끈다.
        kineticScroll: { mouse: !reducedMotion, touch: !reducedMotion },
      });

      const candleSeries: ISeriesApi<'Candlestick'> = chart.addSeries(
        library.CandlestickSeries,
        {
          upColor: CHART_COLORS.bull,
          downColor: CHART_COLORS.bear,
          borderUpColor: CHART_COLORS.bull,
          borderDownColor: CHART_COLORS.bear,
          wickUpColor: CHART_COLORS.bull,
          wickDownColor: CHART_COLORS.bear,
        },
      );

      const volumeSeries: ISeriesApi<'Histogram'> = chart.addSeries(
        library.HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        1,
      );

      chart.panes()[1]?.setStretchFactor(VOLUME_PANE_STRETCH);

      let lastTime: UTCTimestamp | null = null;

      handleRef.current = {
        setCandles: (candles) => {
          const sorted = dedupeAndSort(candles);
          candleSeries.setData(sorted.map(toCandleData));
          volumeSeries.setData(sorted.map(toVolumeData));
          const last = sorted[sorted.length - 1];
          lastTime = last ? toChartTime(last.openTime) : null;
          chart?.timeScale().fitContent();
        },
        updateCandle: (candle) => {
          const time = toChartTime(candle.openTime);
          // 과거 봉이 뒤늦게 도착하면 라이브러리가 예외를 던진다. 조용히 무시한다.
          if (lastTime !== null && time < lastTime) return;
          lastTime = time;
          candleSeries.update(toCandleData(candle));
          volumeSeries.update(toVolumeData(candle));
        },
      };

      setIsReady(true);
    })();

    return () => {
      disposed = true;
      handleRef.current = null;
      setIsReady(false);
      chart?.remove();
      chart = null;
    };
  }, [containerRef, reducedMotion]);

  return { handleRef, isReady, error };
}

/** lightweight-charts 는 시각 오름차순 · 중복 없음을 요구한다. */
function dedupeAndSort(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    const time = Date.parse(candle.openTime);
    if (Number.isNaN(time)) continue;
    byTime.set(time, candle);
  }
  return Array.from(byTime.entries())
    .sort(([a], [b]) => a - b)
    .map(([, candle]) => candle);
}

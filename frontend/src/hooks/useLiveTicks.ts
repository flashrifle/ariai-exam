'use client';

import { useRef, useState } from 'react';

import { useEventStream } from '@/hooks/useEventStream';
import type { Symbol as TradingSymbol, TickEvent } from '@/types/api';

export type PriceDirection = 'up' | 'down' | 'flat';

export interface LivePrice {
  price: number;
  direction: PriceDirection;
  /** 이 값이 바뀔 때마다 플래시를 한 번 재생한다. */
  seq: number;
}

/**
 * SSE `tick` 기반 실시간 가격.
 * 배치(rAF, 최대 ~8회/초) 단위로만 setState 하므로 렌더 폭주가 없다.
 * 반드시 **작은 잎 컴포넌트**에서만 호출할 것.
 */
export function useLivePrice(symbol: TradingSymbol): LivePrice | null {
  const [live, setLive] = useState<LivePrice | null>(null);
  const seqRef = useRef(0);

  useEventStream({
    onTicks: (ticks) => {
      const last = findLastForSymbol(ticks, symbol);
      if (!last) return;
      setLive((prev) => {
        if (prev && prev.price === last.price) return prev;
        seqRef.current += 1;
        const direction: PriceDirection =
          prev === null ? 'flat' : last.price > prev.price ? 'up' : 'down';
        return { price: last.price, direction, seq: seqRef.current };
      });
    },
  });

  return live;
}

export interface TickPressure {
  /** 시장가 매수 체결대금 합 */
  buyQuote: number;
  /** 시장가 매도 체결대금 합 */
  sellQuote: number;
  /** buy / (buy + sell). 표본이 없으면 null */
  ratio: number | null;
  /** 창 안의 체결 건수 */
  count: number;
  /** 집계 창 (ms) */
  windowMs: number;
}

interface TickSample {
  at: number;
  quote: number;
  isBuy: boolean;
}

const EMPTY_PRESSURE: Omit<TickPressure, 'windowMs'> = {
  buyQuote: 0,
  sellQuote: 0,
  ratio: null,
  count: 0,
};

/** 메모리 상한. 초당 수백 건이 들어와도 상한을 넘지 않는다. */
const MAX_SAMPLES = 4_000;

/**
 * 최근 `windowMs` 동안의 체결 방향 압력.
 *
 * 백엔드 `takerBuyRatio`(확정 지표)와 달리 이건 **지금 이 순간의 흐름**이다.
 * 둘을 나란히 놓으면 지표가 갱신되기 전의 변화를 먼저 볼 수 있다.
 */
export function useTickPressure(symbol: TradingSymbol, windowMs = 60_000): TickPressure {
  const samplesRef = useRef<TickSample[]>([]);
  const [pressure, setPressure] = useState(EMPTY_PRESSURE);

  useEventStream({
    onTicks: (ticks) => {
      const now = Date.now();
      const next = samplesRef.current;
      for (const tick of ticks) {
        if (tick.symbol !== symbol) continue;
        // isBuyerMaker === true 면 매수자가 maker → 시장가 "매도" 체결이다.
        next.push({ at: now, quote: tick.price * tick.qty, isBuy: !tick.isBuyerMaker });
      }

      const cutoff = now - windowMs;
      let pruned = next.filter((sample) => sample.at >= cutoff);
      if (pruned.length > MAX_SAMPLES) pruned = pruned.slice(-MAX_SAMPLES);
      samplesRef.current = pruned;

      let buyQuote = 0;
      let sellQuote = 0;
      for (const sample of pruned) {
        if (sample.isBuy) buyQuote += sample.quote;
        else sellQuote += sample.quote;
      }
      const total = buyQuote + sellQuote;
      setPressure((prev) => {
        // 다른 심볼 틱만 들어온 배치에서는 값이 그대로다. 같은 참조를 돌려주면
        // React 가 렌더를 건너뛴다 (초당 8회 헛렌더 방지).
        if (
          prev.buyQuote === buyQuote &&
          prev.sellQuote === sellQuote &&
          prev.count === pruned.length
        ) {
          return prev;
        }
        return {
          buyQuote,
          sellQuote,
          ratio: total > 0 ? buyQuote / total : null,
          count: pruned.length,
        };
      });
    },
  });

  return { ...pressure, windowMs };
}

function findLastForSymbol(
  ticks: readonly TickEvent[],
  symbol: TradingSymbol,
): TickEvent | undefined {
  for (let i = ticks.length - 1; i >= 0; i -= 1) {
    const tick = ticks[i];
    if (tick && tick.symbol === symbol) return tick;
  }
  return undefined;
}

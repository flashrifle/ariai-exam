'use client';

import { useEffect, useRef, useState } from 'react';

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

  // 심볼이 바뀌면 이전 심볼의 가격을 즉시 버린다.
  // 안 그러면 BTC 60,000 → ETH 3,000 을 "하락"으로 판정해 거대한 하락 플래시가 재생된다.
  // effect 가 아니라 렌더 중에 처리해야 이번 렌더 결과부터 반영된다.
  const [trackedSymbol, setTrackedSymbol] = useState(symbol);
  if (trackedSymbol !== symbol) {
    setTrackedSymbol(symbol);
    setLive(null);
  }

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
/** 틱 유입이 없어도 창을 흘려보내기 위한 정리 주기 (ms). */
const PRUNE_INTERVAL_MS = 1_000;

/**
 * 최근 `windowMs` 동안의 체결 방향 압력.
 *
 * 백엔드 `takerBuyRatio`(확정 지표)와 달리 이건 **지금 이 순간의 흐름**이다.
 * 둘을 나란히 놓으면 지표가 갱신되기 전의 변화를 먼저 볼 수 있다.
 */
export function useTickPressure(symbol: TradingSymbol, windowMs = 60_000): TickPressure {
  const samplesRef = useRef<TickSample[]>([]);
  const [pressure, setPressure] = useState(EMPTY_PRESSURE);

  // 심볼 전환 시 이전 심볼의 표본을 즉시 버린다.
  // 안 그러면 창(기본 60초) 동안 두 심볼의 체결대금이 섞인 값이 "실시간 체결강도"로 표시된다.
  const [trackedSymbol, setTrackedSymbol] = useState(symbol);
  if (trackedSymbol !== symbol) {
    setTrackedSymbol(symbol);
    samplesRef.current = [];
    setPressure(EMPTY_PRESSURE);
  }

  useEventStream({
    onTicks: (ticks) => {
      const now = Date.now();
      const next = samplesRef.current;
      for (const tick of ticks) {
        if (tick.symbol !== symbol) continue;
        // isBuyerMaker === true 면 매수자가 maker → 시장가 "매도" 체결이다.
        next.push({ at: now, quote: tick.price * tick.qty, isBuy: !tick.isBuyerMaker });
      }
      samplesRef.current = pruneSamples(next, now - windowMs);
      setPressure((prev) => nextPressureOrSame(prev, samplesRef.current));
    },
  });

  // 틱이 끊겨도 창은 계속 흘러야 한다.
  // onTicks 안에서만 prune 하면 유입이 멈춘 순간의 값이 "최근 60초"라는 라벨을 단 채 동결된다.
  useEffect(() => {
    const timer = setInterval(() => {
      const pruned = pruneSamples(samplesRef.current, Date.now() - windowMs);
      if (pruned.length === samplesRef.current.length) return;
      samplesRef.current = pruned;
      setPressure((prev) => nextPressureOrSame(prev, pruned));
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [windowMs]);

  return { ...pressure, windowMs };
}

/** 창 밖 표본 제거 + 메모리 상한 적용. */
function pruneSamples(samples: readonly TickSample[], cutoff: number): TickSample[] {
  const kept = samples.filter((sample) => sample.at >= cutoff);
  return kept.length > MAX_SAMPLES ? kept.slice(-MAX_SAMPLES) : kept;
}

/**
 * 표본에서 압력을 다시 계산하되, 값이 그대로면 **이전 참조를 그대로 돌려준다.**
 * 다른 심볼 틱만 들어온 배치에서 React 가 렌더를 건너뛰게 하기 위함이다(초당 8회 헛렌더 방지).
 */
function nextPressureOrSame(
  prev: Omit<TickPressure, 'windowMs'>,
  samples: readonly TickSample[],
): Omit<TickPressure, 'windowMs'> {
  let buyQuote = 0;
  let sellQuote = 0;
  for (const sample of samples) {
    if (sample.isBuy) buyQuote += sample.quote;
    else sellQuote += sample.quote;
  }
  if (
    prev.buyQuote === buyQuote &&
    prev.sellQuote === sellQuote &&
    prev.count === samples.length
  ) {
    return prev;
  }
  const total = buyQuote + sellQuote;
  return {
    buyQuote,
    sellQuote,
    ratio: total > 0 ? buyQuote / total : null,
    count: samples.length,
  };
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

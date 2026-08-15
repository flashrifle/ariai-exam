'use client';

import { useEffect, useState } from 'react';

/**
 * 일정 주기로 현재 시각(epoch ms)을 돌려준다.
 * "3초 전" 같은 상대 시각 표시에만 쓴다 — 이 훅을 쓰는 컴포넌트는
 * 주기마다 렌더되므로 최대한 작은 잎 컴포넌트에서만 호출할 것.
 */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

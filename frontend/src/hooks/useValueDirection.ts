'use client';

import { useRef } from 'react';

import type { Direction } from '@/components/ui/DeltaValue';

/**
 * 직전 값과 비교해 변화 방향을 돌려준다 (플래시 색 결정용).
 * 같은 값이 다시 들어오면 아무것도 바뀌지 않으므로 StrictMode 이중 렌더에도 안전하다.
 *
 * 주의: 렌더 중에 ref 를 쓴다. 현재는 일반 setState 갱신만 있어서 문제가 없지만,
 * 이 훅을 쓰는 컴포넌트를 `startTransition`/Suspense 로 감싸면 버려진 렌더가
 * ref 를 오염시켜 방향이 한 번 틀어질 수 있다. 그때는 비교를 useEffect 로 옮길 것.
 */
export function useValueDirection(value: number | null | undefined): Direction {
  const previous = useRef<number | null>(null);
  const direction = useRef<Direction>('flat');

  if (value !== null && value !== undefined && Number.isFinite(value)) {
    if (previous.current !== null && value !== previous.current) {
      direction.current = value > previous.current ? 'up' : 'down';
    }
    previous.current = value;
  }

  return direction.current;
}

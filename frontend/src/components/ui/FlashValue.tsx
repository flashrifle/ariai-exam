'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';

const FLASH_DURATION_MS = 240;

interface FlashValueProps {
  /** 이 값이 바뀔 때마다 플래시를 한 번 재생한다 (보통 시퀀스 번호나 값 자체). */
  trigger: number | string | null;
  direction?: 'up' | 'down' | 'flat';
  children: ReactNode;
  className?: string;
}

/**
 * 값이 갱신될 때 짧게 번쩍이는 마이크로 인터랙션.
 *
 * · 배경색을 직접 애니메이션하지 않는다. 뒤에 깔린 오버레이의 **opacity** 만 움직인다
 *   (레이아웃/페인트 비용 없이 컴포지터에서 처리).
 * · `prefers-reduced-motion` 이면 아예 재생하지 않는다.
 */
export function FlashValue({ trigger, direction = 'flat', children, className }: FlashValueProps) {
  const overlayRef = useRef<HTMLSpanElement>(null);
  const previousTrigger = useRef(trigger);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (previousTrigger.current === trigger) return;
    previousTrigger.current = trigger;
    if (prefersReducedMotion) return;

    const overlay = overlayRef.current;
    if (!overlay || typeof overlay.animate !== 'function') return;
    overlay.animate([{ opacity: 0.3 }, { opacity: 0 }], {
      duration: FLASH_DURATION_MS,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    });
  }, [trigger, prefersReducedMotion]);

  return (
    <span className={`flash-host ${className ?? ''}`}>
      <span ref={overlayRef} className="flash-overlay" data-dir={direction} aria-hidden="true" />
      {children}
    </span>
  );
}

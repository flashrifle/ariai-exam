'use client';

import type { ReactNode } from 'react';

import { FlashValue } from '@/components/ui/FlashValue';
import { useValueDirection } from '@/hooks/useValueDirection';

export type TileTone = 'default' | 'bull' | 'bear' | 'amber';

const TONE_CLASS: Record<TileTone, string> = {
  default: 'text-fg',
  bull: 'text-bull',
  bear: 'text-bear',
  amber: 'text-amber',
};

interface MetricTileProps {
  /** 한국어 지표명 */
  label: string;
  /** 계약상 필드명. 백엔드와 대조할 때 쓰라고 노출한다. */
  code: string;
  /** 이미 포맷된 표시 문자열, 또는 방향 글리프가 포함된 <DeltaValue> */
  value: ReactNode;
  /** 플래시 방향 판정에 쓰는 원본 수치 */
  raw: number | null | undefined;
  tone?: TileTone;
  /** 값 아래 한 줄 보조 설명 */
  hint?: ReactNode;
  className?: string;
}

/**
 * 지표 카드 한 칸.
 * 값이 바뀌면 방향(상승/하락)에 맞는 색으로 짧게 플래시한다.
 */
export function MetricTile({
  label,
  code,
  value,
  raw,
  tone = 'default',
  hint,
  className,
}: MetricTileProps) {
  const direction = useValueDirection(raw ?? null);

  return (
    // 타일 사이 구분선은 부모 그리드의 `gap-px + bg-hairline` 이 만든다 (Swiss 헤어라인 그리드).
    <div className={`bg-ink-900 flex flex-col justify-between gap-2 p-3 ${className ?? ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-micro label-micro-strong">{label}</span>
        <span className="label-micro opacity-60">{code}</span>
      </div>

      <FlashValue trigger={raw ?? null} direction={direction}>
        <span className={`num text-xl leading-none ${TONE_CLASS[tone]}`}>{value}</span>
      </FlashValue>

      {hint ? (
        <div className="label-micro leading-relaxed whitespace-normal normal-case">{hint}</div>
      ) : null}
    </div>
  );
}

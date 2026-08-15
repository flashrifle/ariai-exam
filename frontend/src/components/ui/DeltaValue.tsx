export type Direction = 'up' | 'down' | 'flat';

export function directionOf(value: number | null | undefined, neutralBand = 0): Direction {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'flat';
  if (value > neutralBand) return 'up';
  if (value < -neutralBand) return 'down';
  return 'flat';
}

const TONE_CLASS: Record<Direction, string> = {
  up: 'text-bull',
  down: 'text-bear',
  flat: 'text-fg-muted',
};

const GLYPH: Record<Direction, string> = {
  up: '▲',
  down: '▼',
  flat: '■',
};

const SR_LABEL: Record<Direction, string> = {
  up: '상승',
  down: '하락',
  flat: '보합',
};

interface DeltaValueProps {
  direction: Direction;
  /** 이미 부호가 포함된 표시 문자열 (예: "+1.24%") */
  text: string;
  className?: string;
  showGlyph?: boolean;
}

/**
 * 방향을 **네 겹**으로 인코딩한다: 부호 · 화살표 글리프 · 색 · 스크린리더 텍스트.
 * 색각 이상 사용자도 부호와 글리프만으로 읽을 수 있어야 한다.
 */
export function DeltaValue({ direction, text, className, showGlyph = true }: DeltaValueProps) {
  return (
    <span className={`num inline-flex items-baseline gap-1 ${TONE_CLASS[direction]} ${className ?? ''}`}>
      {showGlyph ? (
        <span aria-hidden="true" className="text-[0.7em] leading-none">
          {GLYPH[direction]}
        </span>
      ) : null}
      <span className="sr-only">{SR_LABEL[direction]}</span>
      <span>{text}</span>
    </span>
  );
}

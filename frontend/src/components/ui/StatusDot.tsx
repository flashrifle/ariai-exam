export type StatusTone = 'ok' | 'warn' | 'down' | 'idle';

interface StatusDotProps {
  tone: StatusTone;
  /** 항상 함께 노출되는 텍스트 라벨. 색만으로 상태를 전달하지 않기 위함. */
  label: string;
  /** 살아 있는 연결이면 은은하게 맥동한다 (opacity 만 사용). */
  pulse?: boolean;
  className?: string;
}

const TONE_TEXT: Record<StatusTone, string> = {
  ok: 'text-bull',
  warn: 'text-amber',
  down: 'text-bear',
  idle: 'text-fg-dim',
};

export function StatusDot({ tone, label, pulse = false, className }: StatusDotProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <span
        className="status-dot"
        data-tone={tone}
        data-live={pulse ? 'true' : 'false'}
        aria-hidden="true"
      />
      <span className={`label-micro ${TONE_TEXT[tone]}`}>{label}</span>
    </span>
  );
}

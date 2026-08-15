'use client';

interface SegmentedControlProps<T extends string> {
  /** 스크린리더용 그룹 이름 */
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** 표시 문자열 변환 (기본: 값 그대로) */
  renderLabel?: (value: T) => string;
  className?: string;
}

/**
 * 심볼 · 인터벌 전환용 세그먼티드 토글.
 * 버튼이라 기본적으로 키보드 포커스가 잡히고, 선택 상태는 `aria-pressed` 로 전달된다.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  renderLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={`seg ${className ?? ''}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="seg-item"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {renderLabel ? renderLabel(option) : option}
        </button>
      ))}
    </div>
  );
}

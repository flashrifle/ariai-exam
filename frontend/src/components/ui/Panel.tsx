import { useId, type ReactNode } from 'react';

interface PanelProps {
  /** 사람이 읽는 제목 (한국어) */
  title: string;
  /** 헤드 우측의 모노 코드 라벨. 터미널 특유의 식별자 표기. */
  code?: string;
  /** 헤드 우측 액션 (토글 등) */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 본문 패딩을 직접 제어하고 싶을 때 (표 · 차트) */
  bodyClassName?: string;
}

/**
 * 모든 정보 블록의 공통 그릇.
 * `<section aria-labelledby>` + `<h2>` 로 스크린리더 탐색이 가능하게 한다.
 */
export function Panel({ title, code, actions, children, className, bodyClassName }: PanelProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={`panel ${className ?? ''}`}>
      <header className="panel-head">
        <h2 id={headingId} className="label-micro label-micro-strong">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {code ? <span className="label-micro">{code}</span> : null}
          {actions}
        </div>
      </header>
      <div className={bodyClassName ?? 'panel-body'}>{children}</div>
    </section>
  );
}

import type { ReactNode } from 'react';

import { toErrorDetail, toErrorMessage } from '@/lib/api/client';

/**
 * 로딩 / 에러 / 빈 상태 표시.
 *
 * 백엔드가 아직 안 떠 있는 상황이 기본값이므로 **무한 스켈레톤을 쓰지 않는다.**
 * 실패는 실패라고 분명히 말하고, 재시도 경로를 준다.
 */

interface BlockProps {
  children: ReactNode;
  className?: string;
}

function Shell({ children, className }: BlockProps) {
  return (
    <div
      className={`flex min-h-24 flex-col items-start justify-center gap-1.5 px-1 py-4 ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

export function LoadingBlock({ label = '불러오는 중' }: { label?: string }) {
  return (
    <Shell>
      <span className="label-micro">{label}</span>
      <span className="num text-fg-dim text-xs" role="status" aria-live="polite">
        요청 대기 중…
      </span>
    </Shell>
  );
}

interface ErrorBlockProps {
  error: unknown;
  onRetry?: () => void;
  /** 어떤 엔드포인트가 실패했는지 (예: GET /ops/health) */
  source?: string;
}

export function ErrorBlock({ error, onRetry, source }: ErrorBlockProps) {
  const detail = toErrorDetail(error);

  return (
    <Shell>
      <span className="label-micro text-bear">데이터를 불러오지 못했습니다</span>
      <p className="text-fg text-xs leading-relaxed">{toErrorMessage(error)}</p>
      {source ? <p className="label-micro">{source}</p> : null}
      {detail ? (
        <p className="num text-fg-dim mt-1 max-w-full text-[11px] leading-relaxed break-words">
          {detail}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className="btn mt-2" onClick={onRetry}>
          다시 시도
        </button>
      ) : null}
    </Shell>
  );
}

export function EmptyBlock({ label, hint }: { label: string; hint?: string }) {
  return (
    <Shell>
      <span className="label-micro">{label}</span>
      {hint ? <p className="text-fg-dim text-xs">{hint}</p> : null}
    </Shell>
  );
}

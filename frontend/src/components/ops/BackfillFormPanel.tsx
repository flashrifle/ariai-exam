'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import { Panel } from '@/components/ui/Panel';
import { useTriggerBackfill } from '@/hooks/useOpsQueries';
import { toErrorDetail, toErrorMessage } from '@/lib/api/client';
import { formatDateTime, localInputToUtcIso, toLocalInputValue } from '@/lib/format';
import { backfillFormSchema, type BackfillFormValues } from '@/lib/schemas';
import { INTERVALS, SYMBOLS, useUiStore } from '@/store/ui-store';

const HOUR_MS = 3_600_000;

/** 빠른 구간 프리셋 (시간 단위). */
const PRESETS = [1, 6, 24] as const;

function defaultRange(hours: number): { from: string; to: string } {
  const now = Date.now();
  return {
    from: toLocalInputValue(new Date(now - hours * HOUR_MS)),
    to: toLocalInputValue(new Date(now)),
  };
}

/**
 * 수동 백필 트리거. `POST /ops/backfill`
 *
 * 검증은 zod 스키마 하나로 통일한다 (클라이언트 즉시 피드백 + 전송 직전 UTC 변환).
 */
export function BackfillFormPanel() {
  const symbol = useUiStore((state) => state.symbol);
  const mutation = useTriggerBackfill();
  const [submittedRange, setSubmittedRange] = useState<{ from: string; to: string } | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BackfillFormValues>({
    resolver: zodResolver(backfillFormSchema),
    defaultValues: { symbol, interval: '1m', ...defaultRange(2) },
  });

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      symbol: values.symbol,
      interval: values.interval,
      from: localInputToUtcIso(values.from),
      to: localInputToUtcIso(values.to),
    };
    setSubmittedRange({ from: payload.from, to: payload.to });
    await mutation.mutateAsync(payload).catch(() => undefined);
  });

  const isBusy = isSubmitting || mutation.isPending;

  return (
    <Panel title="수동 백필" code="POST /ops/backfill">
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="심볼" htmlFor="backfill-symbol" error={errors.symbol?.message}>
            <select
              id="backfill-symbol"
              className="field"
              disabled={isBusy}
              aria-invalid={errors.symbol ? 'true' : undefined}
              {...register('symbol')}
            >
              {SYMBOLS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="인터벌" htmlFor="backfill-interval" error={errors.interval?.message}>
            <select
              id="backfill-interval"
              className="field"
              disabled={isBusy}
              aria-invalid={errors.interval ? 'true' : undefined}
              {...register('interval')}
            >
              {INTERVALS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="시작 (로컬 시각)" htmlFor="backfill-from" error={errors.from?.message}>
          <input
            id="backfill-from"
            type="datetime-local"
            className="field"
            disabled={isBusy}
            aria-invalid={errors.from ? 'true' : undefined}
            {...register('from')}
          />
        </Field>

        <Field label="종료 (로컬 시각)" htmlFor="backfill-to" error={errors.to?.message}>
          <input
            id="backfill-to"
            type="datetime-local"
            className="field"
            disabled={isBusy}
            aria-invalid={errors.to ? 'true' : undefined}
            {...register('to')}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <span className="label-micro">빠른 선택</span>
          {PRESETS.map((hours) => (
            <button
              key={hours}
              type="button"
              className="seg-item border-hairline border"
              disabled={isBusy}
              onClick={() => {
                const range = defaultRange(hours);
                setValue('from', range.from, { shouldValidate: true });
                setValue('to', range.to, { shouldValidate: true });
              }}
            >
              최근 {hours}시간
            </button>
          ))}
        </div>

        <p className="label-micro whitespace-normal">
          입력은 로컬 시각이며, 전송 시 UTC ISO 8601 로 변환됩니다.
        </p>

        <button type="submit" className="btn btn-primary mt-1" disabled={isBusy}>
          {isBusy ? '요청 전송 중…' : '백필 실행'}
        </button>

        <SubmitStatus
          isBusy={isBusy}
          isError={mutation.isError}
          isSuccess={mutation.isSuccess}
          error={mutation.error}
          jobId={mutation.data?.id ?? null}
          range={submittedRange}
        />
      </form>
    </Panel>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="label-micro label-micro-strong">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="label-micro text-bear whitespace-normal">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SubmitStatus({
  isBusy,
  isError,
  isSuccess,
  error,
  jobId,
  range,
}: {
  isBusy: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  jobId: number | null;
  range: { from: string; to: string } | null;
}) {
  if (isBusy) {
    return (
      <p role="status" className="label-micro text-amber whitespace-normal">
        백엔드 응답 대기 중…
      </p>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="border-bear/60 flex flex-col gap-1 border p-2">
        <span className="label-micro text-bear">백필 요청 실패</span>
        <p className="text-fg text-xs leading-relaxed">{toErrorMessage(error)}</p>
        {toErrorDetail(error) ? (
          <p className="num text-fg-dim text-[11px] break-words">{toErrorDetail(error)}</p>
        ) : null}
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div role="status" className="border-bull/50 flex flex-col gap-1 border p-2">
        <span className="label-micro text-bull">
          백필 요청 접수됨{jobId !== null ? ` · 잡 #${jobId}` : ''}
        </span>
        {range ? (
          <p className="num text-fg-muted text-[11px]">
            {formatDateTime(range.from)} → {formatDateTime(range.to)}
          </p>
        ) : null}
        <p className="label-micro whitespace-normal">
          진행 상황은 아래 백필 이력 표에서 확인하세요.
        </p>
      </div>
    );
  }

  return null;
}

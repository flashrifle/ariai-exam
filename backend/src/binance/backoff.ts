/**
 * 지수 백오프 + 지터 계산 유틸.
 * REST 재시도와 WS 재연결이 동일한 정책을 공유한다.
 */

export interface BackoffPolicy {
  /** 첫 시도 대기(ms). */
  baseMs: number;
  /** 대기 상한(ms). 지터 적용 후에도 이 값을 넘지 않는다. */
  maxMs: number;
  /** 지터 비율(0~1). 0.3이면 계산값의 ±30% 범위에서 흔든다. */
  jitterRatio: number;
}

export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  baseMs: 1_000,
  maxMs: 30_000,
  jitterRatio: 0.3,
};

/**
 * attempt(1부터 시작)에 대한 대기 시간(ms)을 계산한다.
 * 동시 재연결 폭주(thundering herd)를 피하기 위해 지터를 섞고,
 * 최종 값은 항상 [0, maxMs] 범위로 고정한다.
 */
export function computeBackoffMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
  random: () => number = Math.random,
): number {
  const boundedAttempt = Math.max(1, Math.floor(attempt));
  const raw = Math.min(policy.baseMs * 2 ** (boundedAttempt - 1), policy.maxMs);
  const jitterSpan = raw * policy.jitterRatio;
  const jittered = raw - jitterSpan + random() * 2 * jitterSpan;
  return Math.min(Math.max(Math.round(jittered), 0), policy.maxMs);
}

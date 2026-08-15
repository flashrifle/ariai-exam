/**
 * 백필 모듈 내부의 작은 비동기 유틸리티 (순수 — 외부 의존 없음).
 */

/** ms 만큼 대기. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** unknown 오류를 사람이 읽을 메시지로 변환. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 동시성 상한을 지키며 작업을 실행하고 결과를 입력 순서대로 반환한다.
 * 백필 job 이 동시에 REST 를 두들겨 weight 를 소모하는 것을 막는 용도.
 *
 * 주의: worker 는 스스로 오류를 처리해 결과 객체로 반환해야 한다.
 * worker 가 던지면 전체가 reject 된다.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const laneCount = Math.max(1, Math.min(limit, items.length));
  const lanes = Array.from({ length: laneCount }, async () => {
    // 각 레인이 다음 작업을 하나씩 가져가는 단순한 작업 풀.
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(lanes);
  return results;
}

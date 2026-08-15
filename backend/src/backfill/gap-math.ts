/**
 * 갭 탐지의 순수 계산 계층. DB·네트워크·시계에 의존하지 않아 단위 테스트 대상이 된다.
 *
 * 원리: 1분봉의 open_time 은 정확히 60초 간격의 이산 시퀀스다.
 * 기대 시퀀스와 실존 집합의 차집합을 구한 뒤 연속 누락을 하나의 구간으로 병합한다.
 */
import type { TimeRange } from './backfill.types';

/** ts를 step 경계로 내림 정렬. */
export function floorToStep(tsMs: number, stepMs: number): number {
  return Math.floor(tsMs / stepMs) * stepMs;
}

/** ts를 step 경계로 올림 정렬. */
export function ceilToStep(tsMs: number, stepMs: number): number {
  return Math.ceil(tsMs / stepMs) * stepMs;
}

/**
 * [fromMs, toMs) 구간에서 기대되는 open_time 시퀀스를 생성한다.
 * from 은 경계로 올림 정렬하고, to 는 미포함이다.
 */
export function buildExpectedOpenTimes(fromMs: number, toMs: number, stepMs: number): number[] {
  const result: number[] = [];
  for (let t = ceilToStep(fromMs, stepMs); t < toMs; t += stepMs) {
    result.push(t);
  }
  return result;
}

/**
 * 기대 시퀀스와 실존 집합의 차집합 (오름차순 유지).
 * 존재 여부 조회가 O(1)이 되도록 Set 을 받는다 — 전체 O(n) 메모리/시간.
 */
export function findMissingOpenTimes(
  expected: readonly number[],
  existing: ReadonlySet<number>,
): number[] {
  return expected.filter((openTime) => !existing.has(openTime));
}

/**
 * 연속된 누락 open_time 들을 반개구간 [startMs, endMs) 목록으로 병합한다.
 * 입력은 오름차순이어야 한다. 낱개 1440개가 아니라 구간 단위 job 을 만들기 위한 핵심.
 */
export function mergeIntoRanges(missing: readonly number[], stepMs: number): TimeRange[] {
  const ranges: TimeRange[] = [];
  let start: number | null = null;
  let prev = 0;
  for (const openTime of missing) {
    if (start === null) {
      start = openTime;
    } else if (openTime !== prev + stepMs) {
      // 연속이 끊겼으므로 지금까지의 구간을 확정한다.
      ranges.push({ startMs: start, endMs: prev + stepMs });
      start = openTime;
    }
    prev = openTime;
  }
  if (start !== null) {
    ranges.push({ startMs: start, endMs: prev + stepMs });
  }
  return ranges;
}

/**
 * 아직 닫히지 않은 현재 진행 중인 봉을 제외하도록 end 를 상한 처리한다.
 * open_time == floor(now) 인 봉은 진행 중이므로, 미포함 상한을 floor(now)로 둔다.
 * (open_time == floor(now) - step 인 봉은 floor(now)에 닫혔으므로 포함된다.)
 */
export function capEndToClosedCandles(endMs: number, nowMs: number, stepMs: number): number {
  return Math.min(endMs, floorToStep(nowMs, stepMs));
}

/** 구간이 담는 봉 개수. */
export function countCandles(range: TimeRange, stepMs: number): number {
  return Math.max(0, Math.ceil((range.endMs - range.startMs) / stepMs));
}

/** 두 반개구간의 겹침 여부. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

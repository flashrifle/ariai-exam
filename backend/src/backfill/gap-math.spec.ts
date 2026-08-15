/**
 * 갭 계산 순수 함수 테스트 — DB·네트워크 없이 검증한다.
 */
import type { TimeRange } from './backfill.types';
import {
  buildExpectedOpenTimes,
  capEndToClosedCandles,
  ceilToStep,
  countCandles,
  findMissingOpenTimes,
  floorToStep,
  mergeIntoRanges,
  rangesOverlap,
} from './gap-math';

const STEP = 60_000;
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const minute = (n: number): number => T0 + n * STEP;

describe('floorToStep / ceilToStep', () => {
  test('분 경계 값은 그대로 유지된다', () => {
    expect(floorToStep(minute(3), STEP)).toBe(minute(3));
    expect(ceilToStep(minute(3), STEP)).toBe(minute(3));
  });

  test('경계 사이 값은 각각 내림/올림 정렬된다', () => {
    const mid = minute(3) + 12_345;
    expect(floorToStep(mid, STEP)).toBe(minute(3));
    expect(ceilToStep(mid, STEP)).toBe(minute(4));
  });
});

describe('buildExpectedOpenTimes', () => {
  test('[from, to) 반개구간의 60초 간격 시퀀스를 만든다', () => {
    expect(buildExpectedOpenTimes(minute(0), minute(3), STEP)).toEqual([
      minute(0),
      minute(1),
      minute(2),
    ]);
  });

  test('정렬되지 않은 from 은 다음 경계로 올림된다', () => {
    expect(buildExpectedOpenTimes(minute(0) + 1, minute(3), STEP)).toEqual([
      minute(1),
      minute(2),
    ]);
  });

  test('from >= to 이면 빈 시퀀스', () => {
    expect(buildExpectedOpenTimes(minute(5), minute(5), STEP)).toEqual([]);
    expect(buildExpectedOpenTimes(minute(6), minute(5), STEP)).toEqual([]);
  });
});

describe('findMissingOpenTimes', () => {
  test('갭이 없으면 빈 배열', () => {
    const expected = [minute(0), minute(1), minute(2)];
    expect(findMissingOpenTimes(expected, new Set(expected))).toEqual([]);
  });

  test('전 구간 누락이면 기대 시퀀스 전체가 반환된다', () => {
    const expected = [minute(0), minute(1)];
    expect(findMissingOpenTimes(expected, new Set())).toEqual(expected);
  });

  test('부분 누락은 오름차순으로 반환된다', () => {
    const expected = [minute(0), minute(1), minute(2), minute(3)];
    const existing = new Set([minute(0), minute(2)]);
    expect(findMissingOpenTimes(expected, existing)).toEqual([minute(1), minute(3)]);
  });
});

describe('mergeIntoRanges', () => {
  test('빈 입력이면 빈 배열', () => {
    expect(mergeIntoRanges([], STEP)).toEqual([]);
  });

  test('연속된 누락은 하나의 구간으로 병합된다 (1440개 낱개 job 방지)', () => {
    const missing = [minute(1), minute(2), minute(3)];
    expect(mergeIntoRanges(missing, STEP)).toEqual([
      { startMs: minute(1), endMs: minute(4) },
    ]);
  });

  test('불연속 누락은 여러 구간으로 나뉜다', () => {
    const missing = [minute(0), minute(1), minute(5), minute(9), minute(10)];
    expect(mergeIntoRanges(missing, STEP)).toEqual([
      { startMs: minute(0), endMs: minute(2) },
      { startMs: minute(5), endMs: minute(6) },
      { startMs: minute(9), endMs: minute(11) },
    ]);
  });

  test('낱개 하나짜리 누락은 한 봉 길이 구간이 된다', () => {
    expect(mergeIntoRanges([minute(7)], STEP)).toEqual([
      { startMs: minute(7), endMs: minute(8) },
    ]);
  });
});

describe('capEndToClosedCandles', () => {
  test('현재 진행 중인 봉(open_time == floor(now))은 상한에서 제외된다', () => {
    const now = minute(10) + 30_000; // 10번째 분이 진행 중
    expect(capEndToClosedCandles(minute(20), now, STEP)).toBe(minute(10));
  });

  test('이미 닫힌 구간의 end 는 그대로 유지된다', () => {
    const now = minute(10) + 30_000;
    expect(capEndToClosedCandles(minute(5), now, STEP)).toBe(minute(5));
  });

  test('now 가 정확히 분 경계일 때 직전 봉은 포함 가능하다 (end 미포함 규칙)', () => {
    // end = minute(10) 이면 open_time < minute(10) 까지 포함 → minute(9) 봉은 닫힘.
    expect(capEndToClosedCandles(minute(20), minute(10), STEP)).toBe(minute(10));
  });
});

describe('countCandles / rangesOverlap', () => {
  test('구간의 봉 개수를 계산한다', () => {
    const range: TimeRange = { startMs: minute(0), endMs: minute(5) };
    expect(countCandles(range, STEP)).toBe(5);
  });

  test('반개구간 겹침 판정 — 끝점이 맞닿은 경우는 겹침이 아니다', () => {
    const a: TimeRange = { startMs: minute(0), endMs: minute(5) };
    const b: TimeRange = { startMs: minute(5), endMs: minute(9) };
    const c: TimeRange = { startMs: minute(4), endMs: minute(6) };
    expect(rangesOverlap(a, b)).toBe(false);
    expect(rangesOverlap(a, c)).toBe(true);
    expect(rangesOverlap(b, c)).toBe(true);
  });
});

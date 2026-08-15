import { computeBackoffMs, type BackoffPolicy } from './backoff';

describe('computeBackoffMs', () => {
  const noJitter: BackoffPolicy = { baseMs: 1_000, maxMs: 30_000, jitterRatio: 0 };

  test('시도 횟수에 따라 지수적으로 증가한다', () => {
    expect(computeBackoffMs(1, noJitter)).toBe(1_000);
    expect(computeBackoffMs(2, noJitter)).toBe(2_000);
    expect(computeBackoffMs(3, noJitter)).toBe(4_000);
    expect(computeBackoffMs(4, noJitter)).toBe(8_000);
  });

  test('대기 상한(maxMs)을 넘지 않는다', () => {
    expect(computeBackoffMs(6, noJitter)).toBe(30_000);
    expect(computeBackoffMs(50, noJitter)).toBe(30_000);
  });

  test('지터가 계산값의 ±비율 범위 안에서 적용된다', () => {
    const policy: BackoffPolicy = { baseMs: 1_000, maxMs: 30_000, jitterRatio: 0.5 };
    expect(computeBackoffMs(1, policy, () => 0)).toBe(500);
    expect(computeBackoffMs(1, policy, () => 0.5)).toBe(1_000);
    expect(computeBackoffMs(1, policy, () => 1)).toBe(1_500);
  });

  test('지터를 적용해도 상한을 넘지 않는다', () => {
    const policy: BackoffPolicy = { baseMs: 1_000, maxMs: 30_000, jitterRatio: 0.5 };
    expect(computeBackoffMs(10, policy, () => 1)).toBe(30_000);
  });

  test('1 미만의 attempt는 1로 취급한다', () => {
    expect(computeBackoffMs(0, noJitter)).toBe(1_000);
    expect(computeBackoffMs(-3, noJitter)).toBe(1_000);
  });
});

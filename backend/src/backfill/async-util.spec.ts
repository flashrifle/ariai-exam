/**
 * 동시성 유틸 테스트 — job 동시 실행 상한이 실제로 지켜지는지 검증한다.
 */
import { runWithConcurrency, sleep, toErrorMessage } from './async-util';

describe('runWithConcurrency', () => {
  test('빈 입력이면 빈 결과', async () => {
    const results = await runWithConcurrency([], 2, () => Promise.resolve(1));
    expect(results).toEqual([]);
  });

  test('결과는 입력 순서대로 반환된다', async () => {
    // Arrange: 앞선 작업이 더 오래 걸리도록 해 완료 순서를 뒤섞는다.
    const items = [30, 10, 20, 5];

    // Act
    const results = await runWithConcurrency(items, 2, async (delayMs, index) => {
      await sleep(delayMs);
      return index;
    });

    // Assert
    expect(results).toEqual([0, 1, 2, 3]);
  });

  test('동시 실행 수가 상한(2)을 넘지 않는다', async () => {
    // Arrange
    let active = 0;
    let peak = 0;

    // Act
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(10);
      active -= 1;
    });

    // Assert
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1); // 병렬성이 실제로 존재하는지도 확인
  });

  test('상한이 항목 수보다 커도 정상 동작한다', async () => {
    const results = await runWithConcurrency([1, 2], 10, (n) => Promise.resolve(n * 2));
    expect(results).toEqual([2, 4]);
  });
});

describe('toErrorMessage', () => {
  test('Error 인스턴스는 message 를 사용한다', () => {
    expect(toErrorMessage(new Error('연결 실패'))).toBe('연결 실패');
  });

  test('그 외 값은 문자열로 변환한다', () => {
    expect(toErrorMessage(429)).toBe('429');
  });
});

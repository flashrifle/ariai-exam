/**
 * GapDetector 테스트 — 가짜 리포지토리로 DB 없이 검증한다.
 * (KlineRepository 는 다른 담당자 작성 영역이라 계약 시그니처만 흉내낸다.)
 */
import type { KlineRepository } from '../db/repositories/kline.repository';
import { GapDetector } from './gap-detector';

const STEP = 60_000;
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const minute = (n: number): number => T0 + n * STEP;

/** 지정한 open_time 들만 존재한다고 답하는 가짜 리포지토리. */
function makeDetector(existingOpenTimes: readonly number[]): GapDetector {
  const fake = {
    findExistingOpenTimes: (
      _symbol: string,
      _interval: string,
      from: Date,
      to: Date,
    ): Promise<Date[]> =>
      Promise.resolve(
        existingOpenTimes
          .filter((t) => t >= from.getTime() && t < to.getTime())
          .map((t) => new Date(t)),
      ),
  };
  return new GapDetector(fake as unknown as KlineRepository);
}

// 스캔 구간보다 충분히 뒤의 현재 시각 (진행 중 봉이 구간에 걸리지 않게).
const NOW_FAR = minute(1000) + 30_000;

describe('GapDetector.detectGaps', () => {
  test('갭이 없으면 빈 배열', async () => {
    const detector = makeDetector([0, 1, 2, 3, 4].map(minute));

    const gaps = await detector.detectGaps(
      'BTCUSDT',
      '1m',
      new Date(minute(0)),
      new Date(minute(5)),
      NOW_FAR,
    );

    expect(gaps).toEqual([]);
  });

  test('중간 한 곳 누락 — 연속 구간 하나로 병합된다', async () => {
    const detector = makeDetector([0, 1, 5, 6].map(minute)); // 2~4 누락

    const gaps = await detector.detectGaps(
      'BTCUSDT',
      '1m',
      new Date(minute(0)),
      new Date(minute(7)),
      NOW_FAR,
    );

    expect(gaps).toEqual([{ startMs: minute(2), endMs: minute(5) }]);
  });

  test('맨 앞·맨 뒤·중간 여러 곳 누락', async () => {
    const detector = makeDetector([2, 3, 5, 6].map(minute)); // 0~1, 4, 7~9 누락

    const gaps = await detector.detectGaps(
      'BTCUSDT',
      '1m',
      new Date(minute(0)),
      new Date(minute(10)),
      NOW_FAR,
    );

    expect(gaps).toEqual([
      { startMs: minute(0), endMs: minute(2) },
      { startMs: minute(4), endMs: minute(5) },
      { startMs: minute(7), endMs: minute(10) },
    ]);
  });

  test('전 구간 누락이면 구간 전체가 갭 하나로 나온다', async () => {
    const detector = makeDetector([]);

    const gaps = await detector.detectGaps(
      'BTCUSDT',
      '1m',
      new Date(minute(0)),
      new Date(minute(10)),
      NOW_FAR,
    );

    expect(gaps).toEqual([{ startMs: minute(0), endMs: minute(10) }]);
  });

  test('현재 진행 중인 봉은 갭으로 잡히지 않는다', async () => {
    // Arrange: 지금은 10번째 분 진행 중 — 9번까지만 닫혔고 DB에는 8번까지 존재.
    const now = minute(10) + 30_000;
    const detector = makeDetector([0, 1, 2, 3, 4, 5, 6, 7, 8].map(minute));

    // Act: 스캔 요청은 미래(12번)까지 넓게 들어와도
    const gaps = await detector.detectGaps(
      'BTCUSDT',
      '1m',
      new Date(minute(0)),
      new Date(minute(12)),
      now,
    );

    // Assert: 닫힌 9번 봉만 갭이고, 진행 중인 10번 봉은 제외된다.
    expect(gaps).toEqual([{ startMs: minute(9), endMs: minute(10) }]);
  });

  test('구간이 비어 있으면(캡 결과 from >= to) 빈 배열', async () => {
    const now = minute(1) + 10_000; // 아직 1번 분 진행 중
    const detector = makeDetector([]);

    const gaps = await detector.detectGaps(
      'BTCUSDT',
      '1m',
      new Date(minute(1)),
      new Date(minute(5)),
      now,
    );

    expect(gaps).toEqual([]);
  });

  test('저장 기준 인터벌(1m)이 아니면 예외', async () => {
    const detector = makeDetector([]);

    await expect(
      detector.detectGaps('BTCUSDT', '5m', new Date(minute(0)), new Date(minute(10)), NOW_FAR),
    ).rejects.toThrow('저장 기준 인터벌');
  });
});

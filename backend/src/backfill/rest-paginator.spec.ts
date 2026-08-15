/**
 * REST 페이지네이션 커서 로직 테스트 — 네트워크 없이 fetchPage 를 흉내낸다.
 */
import { computeMaxPages, paginateKlines, readOpenTimeMs } from './rest-paginator';
import { MAX_PAGES_HARD_CAP } from './backfill.constants';

const STEP = 60_000;
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const minute = (n: number): number => T0 + n * STEP;

/** openTime 만 의미 있는 최소 raw kline 흉내. */
const rawAt = (openTimeMs: number): readonly unknown[] => [openTimeMs, '1', '1', '1', '1', '1'];

interface FetchCall {
  readonly start: number;
  readonly end: number;
  readonly limit: number;
}

/** [start, endInclusive] 에서 limit 개까지 봉을 돌려주는 가짜 서버. */
function makeFakeServer(availableOpenTimes: readonly number[]) {
  const calls: FetchCall[] = [];
  const fetchPage = (start: number, end: number, limit: number): Promise<readonly unknown[]> => {
    calls.push({ start, end, limit });
    const rows = availableOpenTimes
      .filter((t) => t >= start && t <= end)
      .slice(0, limit)
      .map(rawAt);
    return Promise.resolve(rows);
  };
  return { calls, fetchPage };
}

describe('paginateKlines', () => {
  test('한 페이지에 다 들어오면 completed 로 끝난다', async () => {
    // Arrange
    const server = makeFakeServer([minute(0), minute(1), minute(2)]);
    const pagesSeen: number[] = [];

    // Act
    const result = await paginateKlines({
      startMs: minute(0),
      endMs: minute(3),
      stepMs: STEP,
      pageLimit: 1000,
      maxPages: 10,
      fetchPage: server.fetchPage,
      onPage: (rows) => {
        pagesSeen.push(rows.length);
        return Promise.resolve();
      },
    });

    // Assert
    expect(result.stopReason).toBe('completed');
    expect(result.rows).toBe(3);
    expect(pagesSeen).toEqual([3]);
    // endTime 은 미포함 상한을 유지하기 위해 endMs - 1 로 전달된다.
    expect(server.calls[0]).toEqual({ start: minute(0), end: minute(3) - 1, limit: 1000 });
  });

  test('커서는 요청 endTime 이 아니라 "마지막 openTime + step" 으로 전진한다', async () => {
    // Arrange: 5개 봉, 페이지당 2개 → 3페이지
    const server = makeFakeServer([0, 1, 2, 3, 4].map(minute));

    // Act
    const result = await paginateKlines({
      startMs: minute(0),
      endMs: minute(5),
      stepMs: STEP,
      pageLimit: 2,
      maxPages: 10,
      fetchPage: server.fetchPage,
      onPage: () => Promise.resolve(),
    });

    // Assert
    expect(result.stopReason).toBe('completed');
    expect(result.rows).toBe(5);
    expect(server.calls.map((c) => c.start)).toEqual([minute(0), minute(2), minute(4)]);
  });

  test('빈 응답이면 즉시 종료한다 (무한루프 방지)', async () => {
    // Arrange: 서버에 아무 데이터도 없음
    const server = makeFakeServer([]);

    // Act
    const result = await paginateKlines({
      startMs: minute(0),
      endMs: minute(100),
      stepMs: STEP,
      pageLimit: 1000,
      maxPages: 10,
      fetchPage: server.fetchPage,
      onPage: () => Promise.resolve(),
    });

    // Assert
    expect(result.stopReason).toBe('empty_page');
    expect(result.rows).toBe(0);
    expect(server.calls).toHaveLength(1);
  });

  test('커서가 전진하지 않으면 즉시 종료한다', async () => {
    // Arrange: 항상 같은(과거의) 봉만 돌려주는 오동작 서버
    const fetchPage = (): Promise<readonly unknown[]> => Promise.resolve([rawAt(minute(0))]);

    // Act
    const result = await paginateKlines({
      startMs: minute(0),
      endMs: minute(100),
      stepMs: STEP,
      pageLimit: 1000,
      maxPages: 50,
      fetchPage,
      onPage: () => Promise.resolve(),
    });

    // Assert: 첫 페이지는 minute(0) → 커서 minute(1) 전진, 두 번째 페이지에서 정체 감지
    expect(result.stopReason).toBe('cursor_stalled');
  });

  test('openTime 을 읽을 수 없는 마지막 행도 커서 정체로 처리한다', async () => {
    const fetchPage = (): Promise<readonly unknown[]> =>
      Promise.resolve([['이상한 값', '1'] as readonly unknown[]]);

    const result = await paginateKlines({
      startMs: minute(0),
      endMs: minute(10),
      stepMs: STEP,
      pageLimit: 1000,
      maxPages: 10,
      fetchPage,
      onPage: () => Promise.resolve(),
    });

    expect(result.stopReason).toBe('cursor_stalled');
  });

  test('maxPages 상한을 넘으면 종료한다', async () => {
    // Arrange: 무한히 데이터가 있는 서버
    const fetchPage = (start: number): Promise<readonly unknown[]> =>
      Promise.resolve([rawAt(start)]);

    // Act
    const result = await paginateKlines({
      startMs: minute(0),
      endMs: minute(1_000_000),
      stepMs: STEP,
      pageLimit: 1,
      maxPages: 3,
      fetchPage,
      onPage: () => Promise.resolve(),
    });

    // Assert
    expect(result.stopReason).toBe('max_pages_exceeded');
    expect(result.pages).toBe(3);
  });

  test('구간 밖 행은 onPage 로 전달되지 않는다', async () => {
    // Arrange: 서버가 endMs 이후 봉을 섞어서 돌려주는 경우
    const fetchPage = (): Promise<readonly unknown[]> =>
      Promise.resolve([rawAt(minute(0)), rawAt(minute(1)), rawAt(minute(99))]);
    const received: number[] = [];

    // Act
    await paginateKlines({
      startMs: minute(0),
      endMs: minute(2),
      stepMs: STEP,
      pageLimit: 1000,
      maxPages: 5,
      fetchPage,
      onPage: (rows) => {
        rows.forEach((row) => {
          const openTime = readOpenTimeMs(row);
          if (openTime !== null) {
            received.push(openTime);
          }
        });
        return Promise.resolve();
      },
    });

    // Assert
    expect(received).toEqual([minute(0), minute(1)]);
  });
});

describe('computeMaxPages', () => {
  test('봉 수 / 페이지 한도 기준으로 여유분을 더해 계산한다', () => {
    // 4320개 봉(3일) / 1000 = 5페이지 + 여유 2 = 7
    expect(computeMaxPages(minute(0), minute(4320), STEP, 1000)).toBe(7);
  });

  test('하드캡을 넘지 않는다', () => {
    expect(computeMaxPages(0, Number.MAX_SAFE_INTEGER, STEP, 1000)).toBe(MAX_PAGES_HARD_CAP);
  });

  test('빈 구간은 여유분만 남는다', () => {
    expect(computeMaxPages(minute(5), minute(5), STEP, 1000)).toBe(2);
  });
});

describe('readOpenTimeMs', () => {
  test('배열 첫 원소가 유한한 숫자면 그 값을 돌려준다', () => {
    expect(readOpenTimeMs([minute(1), 'x'])).toBe(minute(1));
  });

  test('배열이 아니거나 숫자가 아니면 null', () => {
    expect(readOpenTimeMs('문자열')).toBeNull();
    expect(readOpenTimeMs(['문자열'])).toBeNull();
    expect(readOpenTimeMs([Number.NaN])).toBeNull();
  });
});

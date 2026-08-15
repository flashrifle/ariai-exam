/**
 * 1분봉 upsert 규칙 테스트.
 * "확정 봉이 미확정 봉에 덮이지 않는다"와 계약 §7의 분 경계 불변조건을 고정한다.
 */
import { dedupeBy } from './dedupe';
import {
  assertValidKlines,
  findKlineIssues,
  intervalToMs,
  isAlignedToInterval,
  isAtLeastAsComplete,
  isSupportedInterval,
  klineConflictKey,
  pickMoreCompleteKline,
} from './kline-rules';
import type { KlineInsert } from './schema';

const MINUTE_MS = 60_000;
const OPEN_TIME = new Date('2026-08-15T00:00:00.000Z');

function makeKline(overrides: Partial<KlineInsert> = {}): KlineInsert {
  return {
    symbol: 'BTCUSDT',
    interval: '1m',
    openTime: OPEN_TIME,
    closeTime: new Date(OPEN_TIME.getTime() + MINUTE_MS - 1),
    open: '60000.00000000',
    high: '60100.00000000',
    low: '59900.00000000',
    close: '60050.00000000',
    volume: '1.00000000',
    quoteVolume: '60050.00000000',
    tradeCount: 10,
    takerBuyBase: '0.50000000',
    takerBuyQuote: '30025.00000000',
    source: 'ws',
    ...overrides,
  };
}

describe('intervalToMs / isSupportedInterval', () => {
  test.each([
    ['1m', MINUTE_MS],
    ['5m', 5 * MINUTE_MS],
    ['15m', 15 * MINUTE_MS],
    ['1h', 60 * MINUTE_MS],
  ])('%s 는 %i ms 이다', (interval, expected) => {
    expect(intervalToMs(interval)).toBe(expected);
  });

  test('지원하지 않는 인터벌은 예외를 던진다', () => {
    expect(() => intervalToMs('3m')).toThrow(/지원하지 않는 인터벌/);
  });

  test('타입 가드가 지원 목록만 통과시킨다', () => {
    expect(isSupportedInterval('1m')).toBe(true);
    expect(isSupportedInterval('2h')).toBe(false);
  });
});

describe('isAlignedToInterval', () => {
  test('분 경계에 정렬된 시각은 통과한다', () => {
    expect(isAlignedToInterval(new Date('2026-08-15T12:34:00.000Z'), MINUTE_MS)).toBe(true);
  });

  test.each(['2026-08-15T12:34:00.001Z', '2026-08-15T12:34:30.000Z'])(
    '%s 는 분 경계가 아니다',
    (iso) => {
      expect(isAlignedToInterval(new Date(iso), MINUTE_MS)).toBe(false);
    },
  );

  test('유효하지 않은 Date는 정렬되지 않은 것으로 본다', () => {
    expect(isAlignedToInterval(new Date('not-a-date'), MINUTE_MS)).toBe(false);
  });
});

describe('findKlineIssues / assertValidKlines', () => {
  test('정상 캔들은 위반이 없다', () => {
    expect(findKlineIssues([makeKline()])).toEqual([]);
  });

  test('분 경계를 벗어난 openTime을 잡아낸다 (계약 §7)', () => {
    // Arrange
    const skewed = makeKline({ openTime: new Date(OPEN_TIME.getTime() + 1) });

    // Act
    const issues = findKlineIssues([skewed]);

    // Assert
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/경계에 정렬되지 않았습니다/);
  });

  test('closeTime이 openTime보다 앞서면 잡아낸다', () => {
    // Arrange
    const inverted = makeKline({ closeTime: new Date(OPEN_TIME.getTime() - 1) });

    // Act
    const issues = findKlineIssues([inverted]);

    // Assert
    expect(issues[0]?.reason).toMatch(/closeTime이 openTime보다/);
  });

  test('여러 건의 위반을 첫 건에서 멈추지 않고 모두 모은다', () => {
    // Arrange
    const rows = [
      makeKline({ openTime: new Date(OPEN_TIME.getTime() + 1) }),
      makeKline({ interval: '3m' }),
      makeKline({ symbol: '' }),
    ];

    // Act
    const issues = findKlineIssues(rows);

    // Assert
    expect(issues.map((issue) => issue.index)).toEqual([0, 1, 2]);
  });

  test('위반이 있으면 assert가 예외를 던진다', () => {
    // Arrange
    const rows = [makeKline({ openTime: new Date(OPEN_TIME.getTime() + 500) })];

    // Act & Assert
    expect(() => assertValidKlines(rows)).toThrow(/저장 규칙을 위반했습니다/);
  });

  test('정상 캔들만 있으면 assert는 통과한다', () => {
    expect(() => assertValidKlines([makeKline()])).not.toThrow();
  });
});

describe('klineConflictKey', () => {
  test('기본키(symbol, interval, open_time)가 같으면 같은 키다', () => {
    expect(klineConflictKey(makeKline())).toBe(klineConflictKey(makeKline({ close: '1' })));
  });

  test.each([
    ['symbol', { symbol: 'ETHUSDT' }],
    ['interval', { interval: '5m' }],
    ['openTime', { openTime: new Date(OPEN_TIME.getTime() + MINUTE_MS) }],
  ])('%s 가 다르면 키도 다르다', (_label, override: Partial<KlineInsert>) => {
    expect(klineConflictKey(makeKline())).not.toBe(klineConflictKey(makeKline(override)));
  });
});

describe('isAtLeastAsComplete / pickMoreCompleteKline', () => {
  test('체결 건수가 더 많은 쪽이 더 완전하다', () => {
    // Arrange
    const partial = makeKline({ tradeCount: 3, volume: '0.30000000' });
    const closed = makeKline({ tradeCount: 42, volume: '4.20000000', source: 'rest' });

    // Act & Assert
    expect(isAtLeastAsComplete(closed, partial)).toBe(true);
    expect(isAtLeastAsComplete(partial, closed)).toBe(false);
  });

  test('완전히 같은 재전송은 idempotent하게 통과한다', () => {
    expect(isAtLeastAsComplete(makeKline(), makeKline())).toBe(true);
  });

  test('체결 건수가 같으면 거래량으로 가른다', () => {
    // Arrange
    const smaller = makeKline({ tradeCount: 5, volume: '1.00000000' });
    const larger = makeKline({ tradeCount: 5, volume: '1.00000001' });

    // Act & Assert
    expect(isAtLeastAsComplete(larger, smaller)).toBe(true);
    expect(isAtLeastAsComplete(smaller, larger)).toBe(false);
  });

  test('체결이 하나도 없는 봉끼리는 동률로 본다', () => {
    // Arrange
    const empty = makeKline({ tradeCount: 0, volume: '0.00000000' });

    // Act & Assert
    expect(isAtLeastAsComplete(empty, empty)).toBe(true);
  });

  test('tradeCount가 생략되면 0으로 취급한다', () => {
    // Arrange
    const withoutCount = makeKline({ tradeCount: undefined, volume: '0.00000000' });
    const withCount = makeKline({ tradeCount: 1, volume: '0.10000000' });

    // Act & Assert
    expect(isAtLeastAsComplete(withCount, withoutCount)).toBe(true);
    expect(isAtLeastAsComplete(withoutCount, withCount)).toBe(false);
  });

  test('배치 안에서 확정 봉이 미확정 봉을 이긴다 (순서 무관)', () => {
    // Arrange — 백필(확정)이 먼저 오고 실시간 진행 중 스냅샷이 뒤늦게 도착한 상황
    const closed = makeKline({ tradeCount: 100, volume: '10.00000000', source: 'rest' });
    const inProgress = makeKline({ tradeCount: 7, volume: '0.70000000', source: 'ws' });

    // Act
    const closedFirst = dedupeBy([closed, inProgress], klineConflictKey, pickMoreCompleteKline);
    const inProgressFirst = dedupeBy([inProgress, closed], klineConflictKey, pickMoreCompleteKline);

    // Assert
    expect(closedFirst).toHaveLength(1);
    expect(closedFirst[0]?.tradeCount).toBe(100);
    expect(inProgressFirst).toHaveLength(1);
    expect(inProgressFirst[0]?.tradeCount).toBe(100);
  });
});

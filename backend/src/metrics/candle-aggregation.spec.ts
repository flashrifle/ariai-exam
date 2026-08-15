/**
 * 캔들 집계 유틸 테스트 — 인터벌 매핑과 행 매핑 경계를 DB 없이 검증한다.
 * (open/close 의 시간순 첫/마지막 규칙 자체는 SQL 윈도우 함수가 수행하며,
 *  candle-aggregation.ts 의 프레임 명시 주석과 docs/METRICS.md 3절에 규칙을 문서화했다)
 */
import {
  buildCandlesQuery,
  intervalToSeconds,
  mapCandleRow,
  type CandleRow,
} from './candle-aggregation';

describe('intervalToSeconds', () => {
  it('지원 인터벌을 초로 정확히 환산한다', () => {
    expect(intervalToSeconds('1m')).toBe(60);
    expect(intervalToSeconds('5m')).toBe(300);
    expect(intervalToSeconds('15m')).toBe(900);
    expect(intervalToSeconds('1h')).toBe(3600);
  });
});

describe('mapCandleRow', () => {
  const row: CandleRow = {
    open_time: new Date('2026-08-15T12:00:00.000Z'),
    close_time: new Date('2026-08-15T12:04:59.999Z'),
    open: '64000.10000000',
    high: '64200.00000000',
    low: '63900.50000000',
    close: '64150.25000000',
    volume: '12.34567800',
    quote_volume: '790123.45678900',
    trade_count: 456,
    taker_buy_quote: '395061.72000000',
  };

  it('numeric string 행을 Candle number 필드로 변환한다', () => {
    const candle = mapCandleRow(row);

    expect(candle).toEqual({
      openTime: '2026-08-15T12:00:00.000Z',
      closeTime: '2026-08-15T12:04:59.999Z',
      open: 64000.1,
      high: 64200,
      low: 63900.5,
      close: 64150.25,
      volume: 12.345678,
      quoteVolume: 790123.456789,
      tradeCount: 456,
      takerBuyQuote: 395061.72,
    });
  });

  it('NULL·NaN 값이 들어와도 유한한 number 로 강제한다', () => {
    const broken: CandleRow = { ...row, open: null, volume: 'NaN' };

    const candle = mapCandleRow(broken);

    expect(candle.open).toBe(0);
    expect(candle.volume).toBe(0);
    expect(Number.isFinite(candle.high)).toBe(true);
  });
});

describe('buildCandlesQuery', () => {
  it('1m(원본)과 파생 인터벌 모두 SQL 조립이 예외 없이 완료된다 (스모크)', () => {
    expect(buildCandlesQuery('BTCUSDT', '1m', 200)).toBeDefined();
    expect(buildCandlesQuery('BTCUSDT', '5m', 200)).toBeDefined();
    expect(buildCandlesQuery('ETHUSDT', '15m', 100)).toBeDefined();
    expect(buildCandlesQuery('ETHUSDT', '1h', 24)).toBeDefined();
  });
});

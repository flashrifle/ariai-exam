/**
 * raw kline 검증·변환 테스트 — 가격/수량 문자열 보존과 분 경계 불변조건 확인.
 */
import { assertRawKline, mapRawKlineToInsert } from './kline-mapper';

const STEP = 60_000;
const OPEN_TIME = Date.UTC(2026, 0, 1, 0, 5, 0, 0);
const CLOSE_TIME = OPEN_TIME + STEP - 1;

/** Binance /api/v3/klines 실제 응답과 같은 형태의 유효한 raw. */
const validRaw = (): unknown[] => [
  OPEN_TIME,
  '50000.12345678', // open
  '50100.00000001', // high
  '49900.99999999', // low
  '50050.5', // close
  '123.456', // volume
  CLOSE_TIME,
  '6172839.50', // quoteVolume
  4321, // tradeCount
  '61.728', // takerBuyBase
  '3086419.75', // takerBuyQuote
  '0', // ignore
];

describe('assertRawKline', () => {
  test('유효한 raw 는 통과한다', () => {
    expect(() => assertRawKline(validRaw())).not.toThrow();
  });

  test('배열이 아니면 거부한다', () => {
    expect(() => assertRawKline({ openTime: OPEN_TIME })).toThrow('kline 응답 형식 오류');
  });

  test('원소가 부족하면 거부한다', () => {
    expect(() => assertRawKline(validRaw().slice(0, 5))).toThrow('kline 응답 형식 오류');
  });

  test('가격 자리에 숫자가 오면 거부한다 (문자열 계약 위반)', () => {
    const raw = validRaw();
    raw[1] = 50000.1;
    expect(() => assertRawKline(raw)).toThrow('십진 문자열');
  });

  test('openTime 자리에 문자열이 오면 거부한다', () => {
    const raw = validRaw();
    raw[0] = String(OPEN_TIME);
    expect(() => assertRawKline(raw)).toThrow('유한한 숫자');
  });
});

describe('mapRawKlineToInsert', () => {
  test('가격/수량은 parseFloat 없이 문자열 그대로 보존된다', () => {
    // Act
    const row = mapRawKlineToInsert('BTCUSDT', '1m', validRaw(), STEP);

    // Assert
    expect(row.open).toBe('50000.12345678');
    expect(row.high).toBe('50100.00000001');
    expect(row.low).toBe('49900.99999999');
    expect(row.close).toBe('50050.5');
    expect(row.volume).toBe('123.456');
    expect(row.quoteVolume).toBe('6172839.50');
    expect(row.takerBuyBase).toBe('61.728');
    expect(row.takerBuyQuote).toBe('3086419.75');
  });

  test('시각·건수·출처 필드가 올바르게 매핑된다', () => {
    const row = mapRawKlineToInsert('BTCUSDT', '1m', validRaw(), STEP);

    expect(row.openTime).toEqual(new Date(OPEN_TIME));
    expect(row.closeTime).toEqual(new Date(CLOSE_TIME));
    expect(row.tradeCount).toBe(4321);
    expect(row.source).toBe('rest');
    expect(row.symbol).toBe('BTCUSDT');
    expect(row.interval).toBe('1m');
  });

  test('open_time 이 분 경계에 정렬되지 않으면 예외 (CONTRACT 7절 불변조건)', () => {
    const raw = validRaw();
    raw[0] = OPEN_TIME + 1;
    expect(() => mapRawKlineToInsert('BTCUSDT', '1m', raw, STEP)).toThrow(
      '분 경계에 정렬되지 않았습니다',
    );
  });
});

/**
 * REST 캔들 → upsert 행 변환 테스트.
 *
 * 구조 검증(배열 형태·타입)은 binance-rest.schemas 의 zod 스키마가 담당하므로,
 * 여기서는 이 모듈이 실제로 책임지는 것만 검증한다:
 *  - 가격/수량 문자열 보존 (parseFloat 금지 — numeric 정밀도)
 *  - 분 경계 정렬 불변조건 (CONTRACT 7절)
 *  - 미확정 봉 판정
 */
import type { BinanceKline } from '../binance/binance-rest.schemas';
import { isClosedCandle, toKlineInsert } from './kline-mapper';

const STEP = 60_000;
const OPEN_TIME = Date.UTC(2026, 0, 1, 0, 5, 0, 0);
const CLOSE_TIME = OPEN_TIME + STEP - 1;

/** 소수 자릿수가 살아 있는지 확인하기 위해 일부러 끝자리가 유의미한 값을 쓴다. */
const validKline = (overrides: Partial<BinanceKline> = {}): BinanceKline => ({
  openTime: new Date(OPEN_TIME),
  closeTime: new Date(CLOSE_TIME),
  open: '50000.12345678',
  high: '50100.00000001',
  low: '49900.99999999',
  close: '50050.5',
  volume: '123.456',
  quoteVolume: '6172839.50',
  tradeCount: 4321,
  takerBuyBase: '61.728',
  takerBuyQuote: '3086419.75',
  ...overrides,
});

describe('toKlineInsert', () => {
  test('가격/수량은 parseFloat 없이 문자열 그대로 보존된다', () => {
    // Act
    const row = toKlineInsert('BTCUSDT', '1m', validKline(), STEP);

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
    const row = toKlineInsert('BTCUSDT', '1m', validKline(), STEP);

    expect(row.openTime).toEqual(new Date(OPEN_TIME));
    expect(row.closeTime).toEqual(new Date(CLOSE_TIME));
    expect(row.tradeCount).toBe(4321);
    expect(row.source).toBe('rest');
    expect(row.symbol).toBe('BTCUSDT');
    expect(row.interval).toBe('1m');
  });

  test('open_time 이 분 경계에 정렬되지 않으면 예외 (CONTRACT 7절 불변조건)', () => {
    const kline = validKline({ openTime: new Date(OPEN_TIME + 1) });

    expect(() => toKlineInsert('BTCUSDT', '1m', kline, STEP)).toThrow(
      '분 경계에 정렬되지 않았습니다',
    );
  });
});

describe('isClosedCandle', () => {
  test('봉 길이가 지났으면 확정으로 본다', () => {
    expect(isClosedCandle(validKline(), STEP, OPEN_TIME + STEP)).toBe(true);
    expect(isClosedCandle(validKline(), STEP, OPEN_TIME + STEP * 10)).toBe(true);
  });

  test('아직 진행 중인 봉은 확정이 아니다 — 저장하면 미완성 데이터가 남는다', () => {
    expect(isClosedCandle(validKline(), STEP, OPEN_TIME)).toBe(false);
    expect(isClosedCandle(validKline(), STEP, OPEN_TIME + STEP - 1)).toBe(false);
  });
});

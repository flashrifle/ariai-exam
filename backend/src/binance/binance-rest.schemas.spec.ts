import {
  isMinuteAligned,
  klinesWeightForLimit,
  klineTupleSchema,
  mapKlineTuple,
} from './binance-rest.schemas';

/** Binance /api/v3/klines 실제 응답 형태의 샘플 (배열의 배열). */
const SAMPLE_TUPLE: unknown = [
  1699999980000, // openTime (분 경계 정렬)
  '35000.10000000',
  '35020.00000000',
  '34990.00000000',
  '35010.50000000',
  '12.34500000',
  1700000039999, // closeTime
  '432000.12345678',
  250,
  '6.00000000',
  '210000.00000000',
  '0',
];

describe('klineTupleSchema / mapKlineTuple', () => {
  test('튜플을 도메인 객체로 변환한다 (가격/수량은 문자열 유지)', () => {
    const tuple = klineTupleSchema.parse(SAMPLE_TUPLE);
    const kline = mapKlineTuple(tuple, '1m');

    expect(kline.openTime).toEqual(new Date(1699999980000));
    expect(kline.closeTime).toEqual(new Date(1700000039999));
    expect(kline.open).toBe('35000.10000000');
    expect(kline.high).toBe('35020.00000000');
    expect(kline.low).toBe('34990.00000000');
    expect(kline.close).toBe('35010.50000000');
    expect(kline.volume).toBe('12.34500000');
    expect(kline.quoteVolume).toBe('432000.12345678');
    expect(kline.tradeCount).toBe(250);
    expect(kline.takerBuyBase).toBe('6.00000000');
    expect(kline.takerBuyQuote).toBe('210000.00000000');
  });

  test('가격이 숫자(number)로 오면 검증에 실패한다', () => {
    const invalid = [...(SAMPLE_TUPLE as unknown[])];
    invalid[1] = 35000.1;
    expect(() => klineTupleSchema.parse(invalid)).toThrow();
  });

  test('십진수 형식이 아닌 문자열은 거부한다', () => {
    const invalid = [...(SAMPLE_TUPLE as unknown[])];
    invalid[1] = '3.5e4';
    expect(() => klineTupleSchema.parse(invalid)).toThrow();
  });

  test('1분봉 openTime이 분 경계에 정렬되지 않으면 예외를 던진다', () => {
    const misaligned = [...(SAMPLE_TUPLE as unknown[])];
    misaligned[0] = 1699999980001;
    const tuple = klineTupleSchema.parse(misaligned);
    expect(() => mapKlineTuple(tuple, '1m')).toThrow('분 경계');
  });
});

describe('klinesWeightForLimit', () => {
  test('limit 구간별 weight 규칙 (≤100:1, ≤500:2, ≤1000:5)', () => {
    expect(klinesWeightForLimit(1)).toBe(1);
    expect(klinesWeightForLimit(100)).toBe(1);
    expect(klinesWeightForLimit(101)).toBe(2);
    expect(klinesWeightForLimit(500)).toBe(2);
    expect(klinesWeightForLimit(501)).toBe(5);
    expect(klinesWeightForLimit(1000)).toBe(5);
  });
});

describe('isMinuteAligned', () => {
  test('분 경계 정렬 여부를 판정한다', () => {
    expect(isMinuteAligned(1699999980000)).toBe(true);
    expect(isMinuteAligned(1699999980001)).toBe(false);
    expect(isMinuteAligned(0)).toBe(true);
  });
});

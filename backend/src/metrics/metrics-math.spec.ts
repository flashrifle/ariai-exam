/**
 * 지표 계산 순수 함수 테스트 — DB 없이 손계산 값으로 수치를 검증한다.
 * SQL 집계와 동일한 수식의 참조 구현이 정확한지 확인하는 것이 목적이다.
 */
import {
  annualizeMinuteVolatility,
  clamp01,
  computeLogReturns,
  computeRatio,
  computeSurgeRatio,
  computeTakerBuyRatio,
  computeVwap,
  parseWindowToMinutes,
  sampleStdDev,
  toFiniteNumber,
  toIsoUtc,
} from './metrics-math';
import { MAX_WINDOW_MINUTES } from './metrics.constants';

describe('computeVwap — 거래량가중평균가', () => {
  it('알려진 입력의 손계산 값과 일치한다 (100×2 + 110×1 체결)', () => {
    // Arrange: 거래대금 합 = 100*2 + 110*1 = 310, 수량 합 = 3
    const quoteVolumeSum = 310;
    const volumeSum = 3;

    // Act
    const vwap = computeVwap(quoteVolumeSum, volumeSum);

    // Assert: 310 / 3 = 103.3333... (단순 가격 평균 105 와 다르다)
    expect(vwap).toBeCloseTo(310 / 3, 10);
    expect(vwap).not.toBeCloseTo(105, 1);
  });

  it('거래량 합이 0 이면 계산 불가(null)를 반환한다', () => {
    expect(computeVwap(0, 0)).toBeNull();
    expect(computeVwap(310, 0)).toBeNull();
  });
});

describe('로그수익률 → 표본표준편차 → 연율화 파이프라인', () => {
  it('로그수익률을 시간 순서대로 계산한다', () => {
    const returns = computeLogReturns([100, 105, 110]);

    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(Math.log(1.05), 12);
    expect(returns[1]).toBeCloseTo(Math.log(110 / 105), 12);
  });

  it('0 이하 종가는 ln 정의역 밖이므로 제외한다 (SQL close > 0 필터와 동일)', () => {
    // 0 이 걸러진 뒤 남은 [100, 110] 쌍으로 수익률 1개가 나온다
    const returns = computeLogReturns([100, 0, 110]);

    expect(returns).toEqual([Math.log(1.1)]);
  });

  it('빈 배열·단일 데이터포인트는 수익률을 만들지 못한다', () => {
    expect(computeLogReturns([])).toEqual([]);
    expect(computeLogReturns([100])).toEqual([]);
  });

  it('표본표준편차가 손계산 값과 일치한다 ([1,2,3,4] → √(5/3))', () => {
    // 평균 2.5, 편차제곱합 = 2.25+0.25+0.25+2.25 = 5, 표본분산 = 5/3
    expect(sampleStdDev([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 12);
  });

  it('표본이 2개 미만이면 계산 불가(null) — stddev_samp 와 동일', () => {
    expect(sampleStdDev([])).toBeNull();
    expect(sampleStdDev([0.01])).toBeNull();
  });

  it('변동이 없으면 표준편차는 0 이다', () => {
    expect(sampleStdDev([2, 2, 2])).toBe(0);
  });

  it('연율화 계수는 √525600 이고 % 로 환산한다', () => {
    // 0.001 × √525600 × 100 ≈ 72.498
    expect(annualizeMinuteVolatility(0.001)).toBeCloseTo(0.001 * Math.sqrt(525_600) * 100, 10);
    expect(annualizeMinuteVolatility(0)).toBe(0);
  });

  it('전체 파이프라인이 손계산 값과 일치한다 ([100, 101, 100.5] → 약 764.5%)', () => {
    // r1 = ln(1.01) ≈ 0.0099503, r2 = ln(100.5/101) ≈ -0.0049628
    // 표본표준편차 ≈ 0.0105452 → 연율화 ≈ 764.5%
    const returns = computeLogReturns([100, 101, 100.5]);
    const stdDev = sampleStdDev(returns);

    expect(stdDev).not.toBeNull();
    expect(annualizeMinuteVolatility(stdDev as number)).toBeCloseTo(764.5, 0);
  });
});

describe('비율 지표의 분모 0 방어', () => {
  it('takerBuyRatio: 정상 계산 및 0~1 클램프', () => {
    expect(computeTakerBuyRatio(5, 10)).toBeCloseTo(0.5, 12);
    // 데이터 이상으로 분자가 분모를 넘어도 1 을 넘기지 않는다
    expect(computeTakerBuyRatio(12, 10)).toBe(1);
  });

  it('takerBuyRatio: 거래대금 합이 0 이면 계산 불가(null)', () => {
    expect(computeTakerBuyRatio(0, 0)).toBeNull();
  });

  it('volumeSurgeRatio: 직전 구간 대비 배수를 계산한다', () => {
    expect(computeSurgeRatio(100, 50)).toBeCloseTo(2, 12);
    expect(computeSurgeRatio(0, 50)).toBe(0);
  });

  it('volumeSurgeRatio: 직전 구간이 0 이면 비교 기준이 없어 계산 불가(null)', () => {
    expect(computeSurgeRatio(100, 0)).toBeNull();
    expect(computeSurgeRatio(0, 0)).toBeNull();
  });

  it('computeRatio: 음수·비유한 분모도 방어한다', () => {
    expect(computeRatio(10, -1)).toBeNull();
    expect(computeRatio(10, Number.NaN)).toBeNull();
    expect(computeRatio(Number.POSITIVE_INFINITY, 2)).toBeNull();
  });
});

describe('toFiniteNumber — API 경계 숫자 변환 방어', () => {
  it('numeric string 을 number 로 변환한다', () => {
    expect(toFiniteNumber('65000.12345678')).toBeCloseTo(65000.12345678, 8);
    expect(toFiniteNumber(42)).toBe(42);
  });

  it('NULL·NaN·Infinity 는 fallback 으로 치환해 프론트로 새지 않게 한다', () => {
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber(undefined, -1)).toBe(-1);
    expect(toFiniteNumber('NaN')).toBe(0);
    expect(toFiniteNumber('Infinity')).toBe(0);
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('clamp01', () => {
  it('0~1 범위를 벗어나면 잘라낸다', () => {
    expect(clamp01(0.52)).toBeCloseTo(0.52, 12);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('toIsoUtc', () => {
  it('Date 와 문자열을 ISO 8601 UTC 로 변환한다', () => {
    const iso = '2026-08-15T12:34:56.000Z';
    expect(toIsoUtc(new Date(iso))).toBe(iso);
    expect(toIsoUtc(iso)).toBe(iso);
  });

  it('유효하지 않은 시각은 즉시 실패한다', () => {
    expect(() => toIsoUtc('시각 아님')).toThrow();
  });
});

describe('parseWindowToMinutes — 윈도우 파라미터 파싱', () => {
  const FALLBACK = 60;

  it('단위 접미사를 분으로 환산한다', () => {
    expect(parseWindowToMinutes('45', FALLBACK)).toBe(45);
    expect(parseWindowToMinutes('15m', FALLBACK)).toBe(15);
    expect(parseWindowToMinutes('2h', FALLBACK)).toBe(120);
    expect(parseWindowToMinutes('1d', FALLBACK)).toBe(1440);
  });

  it('비어 있으면 기본 윈도우를 사용한다', () => {
    expect(parseWindowToMinutes(undefined, FALLBACK)).toBe(FALLBACK);
    expect(parseWindowToMinutes('  ', FALLBACK)).toBe(FALLBACK);
  });

  it('잘못된 형식·0 이하 값은 null (호출부에서 400 처리)', () => {
    expect(parseWindowToMinutes('abc', FALLBACK)).toBeNull();
    expect(parseWindowToMinutes('0', FALLBACK)).toBeNull();
    expect(parseWindowToMinutes('-5m', FALLBACK)).toBeNull();
    expect(parseWindowToMinutes('1e3', FALLBACK)).toBeNull();
  });

  it('상한(7일)을 넘으면 클램프한다', () => {
    expect(parseWindowToMinutes('30d', FALLBACK)).toBe(MAX_WINDOW_MINUTES);
  });
});

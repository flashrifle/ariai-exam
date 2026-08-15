/**
 * 지표 계산의 순수 함수 모음.
 *
 * 집계의 원본(source of truth)은 SQL numeric 연산이다 (docs/CONTRACT.md 6절).
 * 이 파일은 두 가지 역할만 담당한다:
 *   1) API 경계의 숫자 변환·방어 (toFiniteNumber, clamp01, toIsoUtc, parseWindowToMinutes)
 *   2) SQL 과 동일한 수식의 참조 구현 — DB 없이 손계산 값으로 수치를 검증하는 테스트 대상
 * 원시 데이터를 JS 부동소수로 누적하는 용도로 사용하지 않는다.
 */
import { MAX_WINDOW_MINUTES, MINUTES_PER_YEAR } from './metrics.constants';
import type { SqlScalar } from './metrics.types';

/**
 * DB 원시 값(numeric string 등)을 유한한 number 로 변환한다.
 * NULL·NaN·Infinity 는 프론트로 새어나가면 안 되므로 fallback 으로 치환한다.
 */
export function toFiniteNumber(value: SqlScalar | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 비율 지표(takerBuyRatio 등)를 0~1 범위로 강제한다. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** DB timestamptz(Date 또는 string) → ISO 8601 UTC 문자열. 잘못된 시각은 즉시 실패시킨다. */
export function toIsoUtc(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`유효하지 않은 시각 값입니다: ${String(value)}`);
  }
  return date.toISOString();
}

const WINDOW_PATTERN = /^(\d+)(m|h|d)?$/;

/**
 * 윈도우 문자열('60', '60m', '24h', '1d')을 분으로 파싱한다.
 * - 비어 있으면 fallbackMinutes 사용
 * - 형식이 잘못되면 null (호출부에서 400 처리)
 * - 1 ~ MAX_WINDOW_MINUTES 범위로 클램프
 */
export function parseWindowToMinutes(
  window: string | undefined,
  fallbackMinutes: number,
): number | null {
  if (window === undefined || window.trim() === '') return clampWindow(fallbackMinutes);
  const match = WINDOW_PATTERN.exec(window.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2] ?? 'm';
  const minutes = unit === 'h' ? amount * 60 : unit === 'd' ? amount * 1440 : amount;
  return clampWindow(minutes);
}

function clampWindow(minutes: number): number {
  return Math.min(Math.max(1, Math.floor(minutes)), MAX_WINDOW_MINUTES);
}

/**
 * 분자/분모 비율. 분모가 0 이하이거나 유한하지 않으면 "계산 불가"로 null 을 반환한다.
 * SQL 의 `CASE WHEN 분모 > 0 THEN 분자/분모 END` 와 동일한 의미다.
 */
export function computeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

/** VWAP = Σ(quoteVolume) / Σ(volume). 거래량이 0 이면 계산 불가(null). */
export function computeVwap(quoteVolumeSum: number, volumeSum: number): number | null {
  return computeRatio(quoteVolumeSum, volumeSum);
}

/** takerBuyRatio = Σ(takerBuyQuote) / Σ(quoteVolume). 거래대금이 0 이면 계산 불가(null). */
export function computeTakerBuyRatio(takerBuyQuoteSum: number, quoteVolumeSum: number): number | null {
  const ratio = computeRatio(takerBuyQuoteSum, quoteVolumeSum);
  return ratio === null ? null : clamp01(ratio);
}

/** volumeSurgeRatio = 최근 구간 / 직전 구간. 직전 구간이 0 이면 비교 기준이 없어 null. */
export function computeSurgeRatio(currentSum: number, previousSum: number): number | null {
  return computeRatio(currentSum, previousSum);
}

/**
 * 1분 로그수익률 r_t = ln(close_t / close_{t-1}).
 * 0 이하 종가는 ln 정의역 밖이므로 먼저 걸러낸다 — SQL 의 `close > 0` 필터와 동일한 규칙.
 */
export function computeLogReturns(closes: readonly number[]): number[] {
  const valid = closes.filter((close) => Number.isFinite(close) && close > 0);
  const returns: number[] = [];
  for (let i = 1; i < valid.length; i += 1) {
    returns.push(Math.log(valid[i] / valid[i - 1]));
  }
  return returns;
}

/**
 * 표본 표준편차 (n-1 분모). 표본이 2개 미만이면 계산 불가(null).
 * PostgreSQL stddev_samp 와 동일한 정의다.
 */
export function sampleStdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const squaredSum = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(squaredSum / (values.length - 1));
}

/**
 * 1분 수익률 표준편차를 연율화해 % 로 환산한다.
 * 분산은 시간에 비례해 누적된다고 가정하므로 σ_연 = σ_1분 × √(1년의 분 수 = 525600).
 */
export function annualizeMinuteVolatility(stdDevPerMinute: number): number {
  return stdDevPerMinute * Math.sqrt(MINUTES_PER_YEAR) * 100;
}

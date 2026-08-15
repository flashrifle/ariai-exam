/**
 * 1분봉 커버리지 계산 (순수 함수).
 *
 * "수집이 실제로 건강한가"를 판단하는 핵심 근거이므로 DB 조회와 분리해 단위 테스트 가능하게 둔다.
 */
import { BASE_INTERVAL, BASE_INTERVAL_MS } from '../../config/configuration';
import type { SupportedSymbol } from '../../config/configuration';
import type { CoverageReport } from '../dto/api-types';

/** 커버리지 판정 구간(시간). */
export const COVERAGE_WINDOW_HOURS = 24;
/** 응답에 싣는 누락 구간 최대 개수. 커버리지 수치 자체는 잘리지 않고 전체 기준으로 계산한다. */
export const MAX_MISSING_RANGES = 50;

export interface CoverageWindow {
  /** 포함 (inclusive) */
  from: Date;
  /** 미포함 (exclusive) */
  to: Date;
  /** 구간 내 기대 봉 수 (24시간 → 1440) */
  expected: number;
}

/** 연속으로 비어 있는 1분봉 묶음. `to` 는 마지막 누락 봉의 openTime(포함). */
export interface MissingGroup {
  from: Date;
  to: Date;
  minutes: number;
}

/**
 * 커버리지 판정 창을 만든다.
 * 진행 중인 현재 분은 아직 확정되지 않았으므로 분 경계로 내림해 제외한다.
 */
export function resolveCoverageWindow(now: Date, hours: number = COVERAGE_WINDOW_HOURS): CoverageWindow {
  const alignedEnd = new Date(Math.floor(now.getTime() / BASE_INTERVAL_MS) * BASE_INTERVAL_MS);
  const expected = Math.round((hours * 3_600_000) / BASE_INTERVAL_MS);
  return {
    from: new Date(alignedEnd.getTime() - expected * BASE_INTERVAL_MS),
    to: alignedEnd,
    expected,
  };
}

/**
 * 누락 묶음 목록 → 커버리지 리포트.
 * ratio 는 소수 4자리로 반올림한다(0.9979 처럼 대시보드에서 바로 읽히게).
 */
export function buildCoverageReport(
  symbol: SupportedSymbol,
  window: CoverageWindow,
  groups: readonly MissingGroup[],
  maxRanges: number = MAX_MISSING_RANGES,
): CoverageReport {
  const missingMinutes = groups.reduce((sum, group) => sum + group.minutes, 0);
  const actual = Math.max(0, window.expected - missingMinutes);
  const ratio = window.expected === 0 ? 1 : roundRatio(actual / window.expected);

  return {
    symbol,
    interval: BASE_INTERVAL,
    expected: window.expected,
    actual,
    ratio,
    missingRanges: groups.slice(0, maxRanges).map((group) => ({
      from: group.from.toISOString(),
      // 마지막 누락 봉의 다음 분 경계까지가 실제 빈 구간이다.
      to: new Date(group.to.getTime() + BASE_INTERVAL_MS).toISOString(),
    })),
  };
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

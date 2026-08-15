/**
 * 1분봉 upsert 규칙 (순수 로직).
 *
 * 백필(REST)과 실시간(WS)이 같은 행을 쓰기 때문에 upsert는 idempotent해야 하고,
 * 동시에 **이미 저장된 확정 봉이 미확정(진행 중) 봉으로 덮이면 안 된다**.
 *
 * 스키마에는 "확정 여부" 컬럼이 없으므로 데이터 자체의 성질을 근거로 판단한다.
 * 같은 1분봉의 체결 건수(trade_count)와 거래량(volume)은 봉이 채워지는 동안
 * **단조 증가**한다. 따라서 값이 더 큰 쪽이 언제나 더 나중, 즉 확정에 가까운 스냅샷이다.
 * REST가 현재 진행 중인 분봉을 미완성 상태로 돌려주는 경우까지 이 규칙 하나로 막힌다.
 *
 * DB 단에서도 같은 규칙을 `ON CONFLICT ... DO UPDATE ... WHERE` 로 강제하며(kline.repository.ts),
 * 여기서는 배치 내부 중복을 접을 때 같은 기준을 적용한다.
 *
 * 외부 의존성은 설정 상수뿐이라 DB 없이 단위 테스트할 수 있다.
 */
import {
  BASE_INTERVAL_MS,
  SUPPORTED_INTERVALS,
  type SupportedInterval,
} from '../config/configuration';
import { joinKey } from './dedupe';
import { compareNumericStrings } from './numeric';
import type { KlineInsert } from './schema';

/** 오류 메시지에 나열할 최대 위반 건수. 나머지는 개수만 알린다. */
const MAX_REPORTED_ISSUES = 5;

const INTERVAL_MS: Readonly<Record<SupportedInterval, number>> = {
  '1m': BASE_INTERVAL_MS,
  '5m': BASE_INTERVAL_MS * 5,
  '15m': BASE_INTERVAL_MS * 15,
  '1h': BASE_INTERVAL_MS * 60,
};

export function isSupportedInterval(value: string): value is SupportedInterval {
  return (SUPPORTED_INTERVALS as readonly string[]).includes(value);
}

/** 인터벌 문자열을 밀리초 길이로 바꾼다. */
export function intervalToMs(interval: string): number {
  if (!isSupportedInterval(interval)) {
    throw new Error(
      `지원하지 않는 인터벌입니다: "${interval}" (허용: ${SUPPORTED_INTERVALS.join(', ')})`,
    );
  }
  return INTERVAL_MS[interval];
}

/**
 * 계약 §7: 1분봉 openTime은 항상 분 경계(ss.mmm = 00.000)에 정렬된다.
 * 이 불변조건이 깨지면 갭 계산이 통째로 어긋나므로 저장 전에 반드시 검증한다.
 */
export function isAlignedToInterval(openTime: Date, intervalMs: number): boolean {
  const epochMs = openTime.getTime();
  return Number.isFinite(epochMs) && epochMs % intervalMs === 0;
}

export interface KlineIssue {
  /** 입력 배열에서의 위치 */
  index: number;
  reason: string;
}

/** 저장 전에 걸러야 할 위반 사항을 모두 찾아낸다(첫 건에서 멈추지 않는다). */
export function findKlineIssues(rows: readonly KlineInsert[]): KlineIssue[] {
  const issues: KlineIssue[] = [];

  rows.forEach((row, index) => {
    if (!row.symbol) {
      issues.push({ index, reason: 'symbol이 비어 있습니다' });
      return;
    }
    if (!isSupportedInterval(row.interval)) {
      issues.push({ index, reason: `지원하지 않는 인터벌: "${row.interval}"` });
      return;
    }

    const openMs = row.openTime.getTime();
    const closeMs = row.closeTime.getTime();

    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) {
      issues.push({ index, reason: 'openTime/closeTime이 유효한 시각이 아닙니다' });
      return;
    }
    if (!isAlignedToInterval(row.openTime, INTERVAL_MS[row.interval])) {
      issues.push({
        index,
        reason: `openTime이 ${row.interval} 경계에 정렬되지 않았습니다: ${row.openTime.toISOString()}`,
      });
    }
    if (closeMs <= openMs) {
      issues.push({ index, reason: 'closeTime이 openTime보다 뒤가 아닙니다' });
    }
  });

  return issues;
}

/** 위반이 하나라도 있으면 예외를 던진다. 잘못된 데이터를 조용히 넘기지 않기 위한 관문. */
export function assertValidKlines(rows: readonly KlineInsert[]): void {
  const issues = findKlineIssues(rows);
  if (issues.length === 0) {
    return;
  }

  const detail = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `  - [${issue.index}] ${issue.reason}`)
    .join('\n');
  const omitted =
    issues.length > MAX_REPORTED_ISSUES ? `\n  ... 외 ${issues.length - MAX_REPORTED_ISSUES}건` : '';

  throw new Error(`캔들 ${issues.length}건이 저장 규칙을 위반했습니다\n${detail}${omitted}`);
}

/** upsert 충돌 키 = 기본키 (symbol, interval, open_time). */
export function klineConflictKey(row: KlineInsert): string {
  return joinKey(row.symbol, row.interval, row.openTime.getTime());
}

/**
 * candidate가 baseline만큼 (혹은 그보다 더) 완전한 스냅샷인지 판단한다.
 * 값이 완전히 같은 재전송도 true를 돌려주어 upsert가 idempotent하게 유지된다.
 */
export function isAtLeastAsComplete(candidate: KlineInsert, baseline: KlineInsert): boolean {
  const candidateCount = candidate.tradeCount ?? 0;
  const baselineCount = baseline.tradeCount ?? 0;
  if (candidateCount !== baselineCount) {
    return candidateCount > baselineCount;
  }
  // 체결 건수가 같으면 거래량으로 가른다 (체결이 없는 봉은 둘 다 0이라 동률 → true).
  return compareNumericStrings(candidate.volume, baseline.volume) >= 0;
}

/** 같은 봉이 배치 안에서 두 번 나왔을 때 더 완전한 쪽을 남긴다. */
export function pickMoreCompleteKline(current: KlineInsert, incoming: KlineInsert): KlineInsert {
  return isAtLeastAsComplete(incoming, current) ? incoming : current;
}

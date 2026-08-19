/**
 * 기동 시퀀스 판단 — 순수 함수.
 *
 * - 과거가 비어 있으면: 최근 bootstrapDays 만큼 채운다 (reason='bootstrap').
 * - 과거가 채워져 있으면: 마지막 저장 지점 다음 봉부터 현재까지가 곧 서버 다운타임 갭이므로
 *   reason='gap_recovery' 로 같은 엔진을 돌린다.
 * - 두 경우 모두 복구 하한을 bootstrapDays 로 클램프해 REST weight 폭주를 막는다.
 *
 * **판단 기준이 latest 가 아니라 earliest 인 이유**:
 * 수집기는 기동 즉시 WS 를 붙이고 미확정 봉도 저장한다. 그래서 latest 만 보면
 * "방금 WS 가 넣은 현재 봉"과 "과거 N일치 적재 완료"를 구분할 수 없고,
 * 빈 DB 인데도 '이미 최신'으로 오판해 최초 백필을 건너뛴다.
 * (실제로 심볼을 순차 처리하는 동안 뒤쪽 심볼이 전부 이 경쟁에 걸렸다.)
 */
import { DAY_MS } from './backfill.constants';
import { floorToStep } from './gap-math';

export interface StartupPlan {
  readonly reason: 'bootstrap' | 'gap_recovery';
  /** 포함 하한 (epoch ms, 분 경계). */
  readonly windowStartMs: number;
  /** 미포함 상한 (epoch ms, 분 경계 = 진행 중 봉 제외). */
  readonly windowEndMs: number;
}

/**
 * @param latestOpenTimeMs DB에 저장된 마지막 1분봉 open_time (없으면 null)
 * @param earliestOpenTimeMs DB에 저장된 가장 오래된 1분봉 open_time (없으면 null)
 * @param nowMs 현재 시각 (UTC epoch ms)
 * @param stepMs 봉 하나의 길이 (1분봉 = 60_000)
 * @param bootstrapDays 최초 백필 깊이(일)
 * @returns 채울 것이 없으면 null
 */
export function resolveStartupPlan(
  latestOpenTimeMs: number | null,
  earliestOpenTimeMs: number | null,
  nowMs: number,
  stepMs: number,
  bootstrapDays: number,
): StartupPlan | null {
  // 진행 중인 현재 분은 백필 대상이 아니다.
  const windowEndMs = floorToStep(nowMs, stepMs);
  const oldestAllowedMs = windowEndMs - bootstrapDays * DAY_MS;
  if (oldestAllowedMs >= windowEndMs) {
    return null;
  }

  // 가장 오래된 봉이 목표 시작점보다 늦으면 그 앞이 비어 있다 → 최초 백필.
  // 이미 존재하는 봉은 갭 탐지가 걸러내므로 구간을 넓게 잡아도 중복 fetch 는 없다.
  if (earliestOpenTimeMs === null || earliestOpenTimeMs > oldestAllowedMs) {
    return { reason: 'bootstrap', windowStartMs: oldestAllowedMs, windowEndMs };
  }

  // 과거는 채워져 있음 → 마지막 저장 지점 이후가 다운타임 갭.
  const windowStartMs = Math.max((latestOpenTimeMs ?? oldestAllowedMs) + stepMs, oldestAllowedMs);
  if (windowStartMs >= windowEndMs) {
    // 이미 최신이거나(직전 봉까지 저장됨) 시계가 어긋난 경우 → 복구 불필요.
    return null;
  }
  return { reason: 'gap_recovery', windowStartMs, windowEndMs };
}

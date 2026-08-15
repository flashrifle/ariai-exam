/**
 * 기동 시퀀스 판단 — 순수 함수.
 *
 * - 저장 데이터가 전혀 없으면: 최근 bootstrapDays 만큼 과거를 채운다 (reason='bootstrap').
 * - 데이터가 있으면: 마지막 저장 지점 다음 봉부터 현재까지가 곧 서버 다운타임 갭이므로
 *   reason='gap_recovery' 로 같은 엔진을 돌린다.
 * - 두 경우 모두 복구 하한을 bootstrapDays 로 클램프해 REST weight 폭주를 막는다.
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
 * @param nowMs 현재 시각 (UTC epoch ms)
 * @param stepMs 봉 하나의 길이 (1분봉 = 60_000)
 * @param bootstrapDays 최초 백필 깊이(일)
 * @returns 채울 것이 없으면 null
 */
export function resolveStartupPlan(
  latestOpenTimeMs: number | null,
  nowMs: number,
  stepMs: number,
  bootstrapDays: number,
): StartupPlan | null {
  // 진행 중인 현재 분은 백필 대상이 아니다.
  const windowEndMs = floorToStep(nowMs, stepMs);
  const oldestAllowedMs = windowEndMs - bootstrapDays * DAY_MS;

  if (latestOpenTimeMs === null) {
    // 데이터가 아예 없음 → 최초 실행 백필.
    if (oldestAllowedMs >= windowEndMs) {
      return null;
    }
    return { reason: 'bootstrap', windowStartMs: oldestAllowedMs, windowEndMs };
  }

  // 데이터가 있음 → 마지막 저장 지점 이후가 다운타임 갭.
  const windowStartMs = Math.max(latestOpenTimeMs + stepMs, oldestAllowedMs);
  if (windowStartMs >= windowEndMs) {
    // 이미 최신이거나(직전 봉까지 저장됨) 시계가 어긋난 경우 → 복구 불필요.
    return null;
  }
  return { reason: 'gap_recovery', windowStartMs, windowEndMs };
}

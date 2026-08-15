/**
 * 기동 시퀀스 판단(순수 함수) 테스트.
 */
import { DAY_MS } from './backfill.constants';
import { resolveStartupPlan } from './startup-plan';

const STEP = 60_000;
// 진행 중 봉 계산을 명확히 하기 위해 분 경계가 아닌 현재 시각을 쓴다.
const NOW = Date.UTC(2026, 0, 10, 12, 30, 45, 123);
const NOW_FLOOR = Date.UTC(2026, 0, 10, 12, 30, 0, 0);

describe('resolveStartupPlan', () => {
  test('데이터가 아예 없으면 bootstrap — 최근 N일 구간', () => {
    // Act
    const plan = resolveStartupPlan(null, NOW, STEP, 3);

    // Assert
    expect(plan).toEqual({
      reason: 'bootstrap',
      windowStartMs: NOW_FLOOR - 3 * DAY_MS,
      windowEndMs: NOW_FLOOR, // 진행 중 봉(12:30)은 제외
    });
  });

  test('데이터가 있으면 마지막 저장 지점 다음 봉부터 gap_recovery', () => {
    // Arrange: 1시간 전 봉까지 저장된 상태 (서버 다운타임 1시간)
    const latest = NOW_FLOOR - 60 * STEP;

    // Act
    const plan = resolveStartupPlan(latest, NOW, STEP, 3);

    // Assert
    expect(plan).toEqual({
      reason: 'gap_recovery',
      windowStartMs: latest + STEP,
      windowEndMs: NOW_FLOOR,
    });
  });

  test('직전 닫힌 봉까지 저장돼 있으면 복구할 것이 없다 (null)', () => {
    // Arrange: 마지막 닫힌 봉 = NOW_FLOOR - STEP
    const latest = NOW_FLOOR - STEP;

    // Act & Assert
    expect(resolveStartupPlan(latest, NOW, STEP, 3)).toBeNull();
  });

  test('마지막 저장 지점이 미래(시계 어긋남)면 null', () => {
    const latest = NOW_FLOOR + 10 * STEP;
    expect(resolveStartupPlan(latest, NOW, STEP, 3)).toBeNull();
  });

  test('다운타임이 부트스트랩 깊이보다 길면 복구 하한을 클램프한다', () => {
    // Arrange: 마지막 저장이 10일 전, 부트스트랩 깊이 3일
    const latest = NOW_FLOOR - 10 * DAY_MS;

    // Act
    const plan = resolveStartupPlan(latest, NOW, STEP, 3);

    // Assert: REST weight 폭주 방지를 위해 최근 3일만 복구
    expect(plan).toEqual({
      reason: 'gap_recovery',
      windowStartMs: NOW_FLOOR - 3 * DAY_MS,
      windowEndMs: NOW_FLOOR,
    });
  });
});

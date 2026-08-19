/**
 * 기동 시퀀스 판단(순수 함수) 테스트.
 */
import { DAY_MS } from './backfill.constants';
import { resolveStartupPlan } from './startup-plan';

const STEP = 60_000;
// 진행 중 봉 계산을 명확히 하기 위해 분 경계가 아닌 현재 시각을 쓴다.
const NOW = Date.UTC(2026, 0, 10, 12, 30, 45, 123);
const NOW_FLOOR = Date.UTC(2026, 0, 10, 12, 30, 0, 0);
/** 부트스트랩 깊이(3일)보다 과거 → "과거가 채워진 상태"를 뜻한다. */
const OLD_ENOUGH = NOW_FLOOR - 5 * DAY_MS;

describe('resolveStartupPlan', () => {
  test('데이터가 아예 없으면 bootstrap — 최근 N일 구간', () => {
    // Act
    const plan = resolveStartupPlan(null, null, NOW, STEP, 3);

    // Assert
    expect(plan).toEqual({
      reason: 'bootstrap',
      windowStartMs: NOW_FLOOR - 3 * DAY_MS,
      windowEndMs: NOW_FLOOR, // 진행 중 봉(12:30)은 제외
    });
  });

  test('과거가 채워져 있으면 마지막 저장 지점 다음 봉부터 gap_recovery', () => {
    // Arrange: 1시간 전 봉까지 저장된 상태 (서버 다운타임 1시간)
    const latest = NOW_FLOOR - 60 * STEP;

    // Act
    const plan = resolveStartupPlan(latest, OLD_ENOUGH, NOW, STEP, 3);

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
    expect(resolveStartupPlan(latest, OLD_ENOUGH, NOW, STEP, 3)).toBeNull();
  });

  test('마지막 저장 지점이 미래(시계 어긋남)면 null', () => {
    const latest = NOW_FLOOR + 10 * STEP;

    expect(resolveStartupPlan(latest, OLD_ENOUGH, NOW, STEP, 3)).toBeNull();
  });

  test('다운타임이 부트스트랩 깊이보다 길면 복구 하한을 클램프한다', () => {
    // Arrange: 마지막 저장이 10일 전, 부트스트랩 깊이 3일
    const latest = NOW_FLOOR - 10 * DAY_MS;

    // Act
    const plan = resolveStartupPlan(latest, NOW_FLOOR - 10 * DAY_MS, NOW, STEP, 3);

    // Assert: REST weight 폭주 방지를 위해 최근 3일만 복구
    expect(plan).toEqual({
      reason: 'gap_recovery',
      windowStartMs: NOW_FLOOR - 3 * DAY_MS,
      windowEndMs: NOW_FLOOR,
    });
  });

  /* ── earliest 기반 판단 (회귀 방지) ─────────────────────────────── */

  test('실시간 WS 가 방금 넣은 봉 하나만 있으면 여전히 bootstrap 이다', () => {
    // Arrange: 수집기는 기동 즉시 WS 를 붙여 미확정 봉을 저장한다.
    // 그래서 latest 는 "직전 봉"을 가리키지만 과거는 텅 비어 있다.
    // latest 만 보고 판단하면 '이미 최신'으로 오판해 최초 백필을 건너뛰었다(실제 발생한 버그).
    const justInserted = NOW_FLOOR - STEP;

    // Act
    const plan = resolveStartupPlan(justInserted, justInserted, NOW, STEP, 3);

    // Assert
    expect(plan).toEqual({
      reason: 'bootstrap',
      windowStartMs: NOW_FLOOR - 3 * DAY_MS,
      windowEndMs: NOW_FLOOR,
    });
  });

  test('과거가 부분만 채워져 있으면(1일치) bootstrap 으로 나머지를 메운다', () => {
    // Arrange: 최근 1일치만 있고 그 앞 2일이 빈 상태
    const earliest = NOW_FLOOR - 1 * DAY_MS;
    const latest = NOW_FLOOR - STEP;

    // Act
    const plan = resolveStartupPlan(latest, earliest, NOW, STEP, 3);

    // Assert: 이미 있는 봉은 갭 탐지가 걸러내므로 구간을 넓게 잡아도 중복 fetch 는 없다
    expect(plan).toEqual({
      reason: 'bootstrap',
      windowStartMs: NOW_FLOOR - 3 * DAY_MS,
      windowEndMs: NOW_FLOOR,
    });
  });

  test('earliest 가 목표 시작점과 같으면 과거가 채워진 것으로 본다', () => {
    // Arrange: 정확히 3일치가 적재된 상태 → 매 재기동마다 bootstrap 이 반복되면 안 된다
    const earliest = NOW_FLOOR - 3 * DAY_MS;
    const latest = NOW_FLOOR - 10 * STEP;

    // Act
    const plan = resolveStartupPlan(latest, earliest, NOW, STEP, 3);

    // Assert
    expect(plan?.reason).toBe('gap_recovery');
  });
});

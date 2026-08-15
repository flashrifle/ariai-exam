/**
 * 백필 모듈 상수. 매직 넘버 금지 규칙에 따라 여기서만 정의한다.
 */

/** 하루의 밀리초. */
export const DAY_MS = 86_400_000;

/** 한 시간의 밀리초. */
export const HOUR_MS = 3_600_000;

/** Binance /api/v3/klines 한 요청당 최대 캔들 수 (limit=1000, weight 5). */
export const KLINES_PAGE_LIMIT = 1000;

/** job 최대 시도 횟수. 소진 시 failed 로 남기고 에러를 기록한다. */
export const MAX_JOB_ATTEMPTS = 3;

/** 재시도 기본 지연(ms). 시도 횟수에 비례해 늘어난다. */
export const RETRY_BASE_DELAY_MS = 3_000;

/** 동시에 실행할 백필 job 상한 — REST weight 예산 보호. */
export const JOB_CONCURRENCY = 2;

/** 페이지네이션 무한루프 방지를 위한 절대 상한 (계산치와 별개의 하드캡). */
export const MAX_PAGES_HARD_CAP = 500;

/** 예상 페이지 수에 더하는 여유분 (경계 중복 등 대비). */
export const MAX_PAGES_SAFETY_MARGIN = 2;

/**
 * 주기 갭 스캔에서 방금 닫힌 봉 N개는 제외한다.
 * WS 실시간 경로가 확정 봉을 DB에 반영할 시간을 주기 위한 유예이며,
 * 실제 누락이라면 다음 스캔 주기에 잡힌다.
 */
export const GAP_SCAN_GRACE_CANDLES = 1;

/** 수동 백필 1회 요청의 최대 구간(일) — 과도한 REST 소모 방지. */
export const MANUAL_MAX_RANGE_DAYS = 30;

/** SchedulerRegistry 에 등록하는 갭 스캔 인터벌 이름. */
export const GAP_SCAN_INTERVAL_NAME = 'backfill.gap-scan';

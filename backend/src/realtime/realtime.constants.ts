/**
 * SSE 튜닝 상수.
 *
 * 값의 근거를 주석으로 남긴다 — 이 숫자들이 "브라우저가 죽느냐 마느냐"를 가른다.
 */

/** docs/CONTRACT.md 의 SSE 이벤트 이름. 프론트가 addEventListener 로 구독하는 값이다. */
export const SSE_EVENTS = {
  TICK: 'tick',
  CANDLE: 'candle',
  METRICS: 'metrics',
  OPS: 'ops',
  /** 계약 외 유지용 이벤트. 프록시가 유휴 연결을 끊는 것을 막는다. */
  PING: 'ping',
} as const;

/**
 * 체결(tick) 샘플링 주기.
 * BTCUSDT 는 초당 수십~수백 건이 들어온다. 심볼별로 이 주기마다 최신값만 내보낸다.
 */
export const TICK_THROTTLE_MS = 250;

/** 미확정 1분봉 갱신 샘플링 주기. 확정봉(kline.closed)은 스로틀링하지 않는다. */
export const KLINE_UPDATE_THROTTLE_MS = 500;

/** 하트비트 주기. 대부분의 리버스 프록시 유휴 타임아웃(30~60초)보다 넉넉히 짧게 잡는다. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** stream.status / backfill.progress 가 몰려 들어와도 health 재계산은 이 주기로 제한한다. */
export const OPS_PUSH_THROTTLE_MS = 2_000;

/** 이벤트가 전혀 없어도 lagSeconds 가 늙는 것을 보여주기 위한 주기적 재계산. */
export const OPS_REFRESH_INTERVAL_MS = 10_000;

/** 클라이언트 재연결 대기(ms). SSE `retry:` 필드로 내려보낸다. */
export const SSE_RETRY_MS = 3_000;

/**
 * 지표 모듈이 스냅샷 갱신을 알릴 때 사용하는 이벤트 이름.
 * `common/events.ts`(팀 리더 관리)에 아직 항목이 없어 여기서 정의한다.
 * events.ts 에 정식 추가되면 그 상수로 교체할 것.
 */
export const METRICS_SNAPSHOT_EVENT = 'metrics.snapshot';

/**
 * 클라이언트 번들에 인라인되는 환경변수.
 * Next 는 `process.env.NEXT_PUBLIC_*` 를 "문자열 리터럴 그대로" 치환하므로
 * 반드시 전체 이름을 그대로 써야 한다 (동적 접근 금지).
 */

/** 백엔드 API 베이스. docs/CONTRACT.md 5절 기준 `/api/v1`. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/**
 * 목 모드. 기본값은 false(실제 API).
 * true 일 때만 `src/lib/mock/**` 이 동적 import 되며,
 * false 로 빌드하면 번들러가 해당 분기를 통째로 제거한다.
 */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

/** SSE 엔드포인트 (`GET /stream`). */
export const STREAM_URL = `${API_BASE_URL}/stream`;

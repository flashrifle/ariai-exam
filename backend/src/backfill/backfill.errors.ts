/**
 * 백필 모듈 오류 타입.
 */

/** 수동 백필 요청 검증 실패 — 운영 API 에서 HTTP 400 으로 매핑해 사용한다. */
export class BackfillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillValidationError';
  }
}

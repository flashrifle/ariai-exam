/**
 * 모든 HTTP 응답이 공유하는 봉투(envelope).
 * docs/CONTRACT.md 5절 및 frontend/src/types/api.ts 의 `ApiResponse<T>` 와
 * 필드명·형태가 글자 단위로 일치해야 한다.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

/** 성공 응답 봉투를 만든다. */
export function okEnvelope<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

/** 실패 응답 봉투를 만든다. 내부 상세는 절대 담지 않는다. */
export function failEnvelope(error: string): ApiResponse<never> {
  return { success: false, data: null, error };
}

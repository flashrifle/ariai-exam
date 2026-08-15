/**
 * 서버 로그 전용 에러 서술.
 * **클라이언트 응답에는 절대 쓰지 말 것** — 스택트레이스·DB 에러 원문이 그대로 담긴다.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** 로그 메시지용으로 unknown 오류를 안전하게 문자열화한다. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

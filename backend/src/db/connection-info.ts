/**
 * 접속 문자열에서 비밀번호를 제거한 요약을 만든다.
 *
 * DATABASE_URL에는 비밀번호가 들어 있으므로 로그에 그대로 찍으면 안 된다.
 * 그렇다고 아무것도 남기지 않으면 "어느 DB에 붙었는지" 확인이 불가능하므로,
 * 자격증명만 지우고 host/port/database 만 남긴다.
 *
 * 이 파일은 외부 의존성이 전혀 없는 순수 모듈이다(DB 없이 단위 테스트 가능).
 */

/**
 * @returns `user@host:port/database` 형태의 요약. 파싱에 실패하면 '(해석 불가)'.
 */
export function describeConnection(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const host = url.hostname || '(호스트 미지정)';
    const port = url.port || '5432';
    const database = url.pathname.replace(/^\//, '') || '(DB 미지정)';
    const user = url.username ? `${url.username}@` : '';
    return `${user}${host}:${port}/${database}`;
  } catch {
    // 형식이 달라도 비밀번호가 새어 나가면 안 되므로 원본은 절대 반환하지 않는다.
    return '(해석 불가)';
  }
}

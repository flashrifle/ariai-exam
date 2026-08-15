/**
 * 배치 내부 중복 제거.
 *
 * 하나의 `INSERT ... ON CONFLICT DO UPDATE` 문 안에 동일한 충돌 키가 두 번 등장하면
 * PostgreSQL은 다음 오류로 문장 전체를 실패시킨다.
 *
 *   ON CONFLICT DO UPDATE command cannot affect row a second time
 *
 * 백필 페이지 경계 중복, WS 재연결 직후 재전송처럼 **정상 운영 중에 실제로 발생하는**
 * 상황이므로, 쿼리를 만들기 전에 충돌 키 기준으로 반드시 한 번 접어야 한다.
 *
 * 이 파일은 외부 의존성이 전혀 없는 순수 모듈이다(DB 없이 단위 테스트 가능).
 */

/**
 * 충돌 키가 같은 행들을 하나로 접는다.
 *
 * - 최초 등장 순서를 보존한다 (Map은 기존 키를 다시 set 해도 순서를 유지한다).
 * - 원본 배열과 원본 행 객체를 변경하지 않는다.
 *
 * @param rows       입력 행
 * @param keyOf      행에서 충돌 키(문자열)를 뽑는 함수
 * @param pickWinner 같은 키가 충돌했을 때 살아남을 행을 고르는 함수.
 *                   기본값은 "나중에 온 행이 이긴다"(last-write-wins).
 */
export function dedupeBy<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  pickWinner: (current: T, incoming: T) => T = (_current, incoming) => incoming,
): T[] {
  if (rows.length === 0) {
    return [];
  }

  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = byKey.get(key);
    byKey.set(key, current === undefined ? row : pickWinner(current, row));
  }

  return Array.from(byKey.values());
}

/**
 * 복합 키를 문자열로 합칠 때 쓰는 구분자.
 * 심볼(대문자+숫자), 인터벌(숫자+소문자), epoch ms(숫자) 어디에도 등장하지 않는 문자라
 * 서로 다른 조합이 같은 문자열로 뭉개지지 않는다.
 */
export const KEY_SEPARATOR = '|';

/** 여러 조각을 충돌 키 문자열 하나로 합친다. */
export function joinKey(...parts: readonly (string | number | bigint)[]): string {
  return parts.map((part) => String(part)).join(KEY_SEPARATOR);
}

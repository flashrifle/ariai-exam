/**
 * raw SQL 실행 결과에서 행 배열을 안전하게 꺼낸다.
 *
 * drizzle 드라이버/버전에 따라 `db.execute()` 는 pg 의 `QueryResult`({ rows })를 주기도 하고
 * 행 배열을 그대로 주기도 한다. 이 얇은 어댑터로 양쪽을 모두 흡수한다.
 */
export type SqlRow = Record<string, unknown>;

export function extractRows(result: unknown): SqlRow[] {
  if (Array.isArray(result)) {
    return result as SqlRow[];
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as SqlRow[];
    }
  }
  return [];
}

/** 단일 행 조회 결과. 없으면 null. */
export function extractFirstRow(result: unknown): SqlRow | null {
  const rows = extractRows(result);
  return rows.length > 0 ? rows[0] : null;
}

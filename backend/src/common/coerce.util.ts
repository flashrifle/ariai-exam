/**
 * DB(row) → API 경계 변환 헬퍼.
 *
 * drizzle/pg 는 numeric 을 string 으로, timestamptz 를 Date 로 돌려준다.
 * docs/CONTRACT.md 6·7절에 따라 API 경계에서만 number / ISO8601(UTC) 문자열로 바꾼다.
 * (합계·비율 등 집계 자체는 SQL numeric 연산으로 끝낸 뒤 여기서 표시용으로만 변환한다.)
 */

/** numeric(string) · number · null 을 표시용 number 로 바꾼다. 해석 불가면 fallback. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** timestamptz(Date) · ISO 문자열 · epoch(ms) 를 ISO8601 UTC 문자열로 바꾼다. */
export function toIsoString(value: unknown): string {
  const iso = toNullableIsoString(value);
  if (iso === null) {
    throw new TypeError('시각 값을 ISO8601 문자열로 변환할 수 없습니다');
  }
  return iso;
}

/** nullable 시각 변환. 해석 불가하거나 null 이면 null. */
export function toNullableIsoString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

/** 두 시각 사이의 경과 초. 소수 1자리까지 유지해 지연을 민감하게 보여준다. */
export function elapsedSeconds(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 1000) * 10) / 10;
}

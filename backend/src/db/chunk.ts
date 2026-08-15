/**
 * 대량 삽입 안전장치.
 *
 * PostgreSQL의 확장 쿼리 프로토콜은 한 문장이 가질 수 있는 바인드 파라미터를
 * 65535개(int16 범위)로 제한한다. `INSERT ... VALUES` 는 "행 수 × 컬럼 수" 만큼
 * 파라미터를 소비하므로, 행 수만 보고 배치를 자르면 컬럼이 많은 테이블에서 그대로 터진다.
 *   - klines: 15컬럼 → 4369행이 실질 상한
 *   - trades:  8컬럼 → 8191행이 실질 상한
 * 따라서 청크 크기는 반드시 **컬럼 수를 기준으로** 계산한다.
 *
 * 이 파일은 외부 의존성이 전혀 없는 순수 모듈이다(DB 없이 단위 테스트 가능).
 */

/** PostgreSQL 한 문장당 바인드 파라미터 상한. */
export const PG_MAX_BIND_PARAMS = 65535;

/**
 * 안전 마진. ON CONFLICT 절이나 이후 추가될 조건절이 파라미터를 더 쓰더라도
 * 상한을 넘지 않도록 미리 떼어두는 몫이다.
 */
export const BIND_PARAM_RESERVE = 64;

/**
 * 한 청크의 최대 행 수 상한.
 * 파라미터 여유가 남아 있어도 문장이 지나치게 커지면 메모리·락 유지시간이 나빠지므로
 * 별도의 상한을 둔다.
 */
export const DEFAULT_MAX_ROWS_PER_CHUNK = 2000;

export interface ChunkSizeOptions {
  /** 파라미터 상한 (기본값: PostgreSQL의 65535). 테스트에서 경계값을 주입할 때 사용. */
  maxBindParams?: number;
  /** 안전 마진 (기본값: BIND_PARAM_RESERVE). */
  reserve?: number;
  /** 행 수 상한 (기본값: DEFAULT_MAX_ROWS_PER_CHUNK). */
  maxRows?: number;
}

/**
 * 컬럼 수를 기준으로 한 번에 삽입해도 안전한 행 수를 계산한다.
 *
 * @param columnCount INSERT 문이 행마다 채우는 컬럼 수
 * @throws 컬럼 수가 비정상이거나, 한 행조차 파라미터 상한에 담을 수 없는 경우
 */
export function calcChunkSize(columnCount: number, options: ChunkSizeOptions = {}): number {
  const {
    maxBindParams = PG_MAX_BIND_PARAMS,
    reserve = BIND_PARAM_RESERVE,
    maxRows = DEFAULT_MAX_ROWS_PER_CHUNK,
  } = options;

  if (!Number.isInteger(columnCount) || columnCount <= 0) {
    throw new Error(`컬럼 수는 1 이상의 정수여야 합니다 (받은 값: ${columnCount})`);
  }
  if (!Number.isInteger(maxBindParams) || maxBindParams <= 0) {
    throw new Error(`파라미터 상한은 1 이상의 정수여야 합니다 (받은 값: ${maxBindParams})`);
  }
  if (!Number.isInteger(reserve) || reserve < 0) {
    throw new Error(`안전 마진은 0 이상의 정수여야 합니다 (받은 값: ${reserve})`);
  }
  if (!Number.isInteger(maxRows) || maxRows <= 0) {
    throw new Error(`행 수 상한은 1 이상의 정수여야 합니다 (받은 값: ${maxRows})`);
  }

  const usableParams = maxBindParams - reserve;
  const rowsByParams = Math.floor(usableParams / columnCount);

  if (rowsByParams < 1) {
    throw new Error(
      `컬럼이 ${columnCount}개라 한 행도 파라미터 상한(${maxBindParams}, 마진 ${reserve})에 담을 수 없습니다`,
    );
  }

  return Math.min(rowsByParams, maxRows);
}

/**
 * 행 배열을 고정 크기 청크로 자른다. 원본 배열은 변경하지 않는다.
 * 빈 배열이면 빈 배열을 돌려주므로 호출부는 자연스럽게 쿼리를 한 번도 실행하지 않는다.
 */
export function chunkRows<T>(rows: readonly T[], chunkSize: number): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`청크 크기는 1 이상의 정수여야 합니다 (받은 값: ${chunkSize})`);
  }
  if (rows.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    chunks.push(rows.slice(offset, offset + chunkSize));
  }
  return chunks;
}

/** `calcChunkSize` + `chunkRows` 를 한 번에 적용하는 편의 함수. */
export function chunkByColumnCount<T>(
  rows: readonly T[],
  columnCount: number,
  options: ChunkSizeOptions = {},
): T[][] {
  if (rows.length === 0) {
    return [];
  }
  return chunkRows(rows, calcChunkSize(columnCount, options));
}

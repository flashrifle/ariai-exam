/**
 * 대량 삽입 청크 계산 테스트.
 * DB 연결 없이 순수 계산만 검증한다 (파라미터 상한 경계값 중심).
 */
import {
  BIND_PARAM_RESERVE,
  DEFAULT_MAX_ROWS_PER_CHUNK,
  PG_MAX_BIND_PARAMS,
  calcChunkSize,
  chunkByColumnCount,
  chunkRows,
} from './chunk';

describe('calcChunkSize', () => {
  test('컬럼 수가 늘어나면 청크 크기가 줄어든다', () => {
    // Arrange
    const options = { maxRows: Number.MAX_SAFE_INTEGER };

    // Act
    const fewColumns = calcChunkSize(4, options);
    const manyColumns = calcChunkSize(16, options);

    // Assert
    expect(fewColumns).toBeGreaterThan(manyColumns);
  });

  test('청크 하나가 소비하는 파라미터가 PostgreSQL 상한을 넘지 않는다', () => {
    // Arrange
    const columnCounts = [1, 2, 8, 15, 16, 32, 64, 128];

    // Act & Assert
    for (const columnCount of columnCounts) {
      const size = calcChunkSize(columnCount, { maxRows: Number.MAX_SAFE_INTEGER });
      expect(size * columnCount).toBeLessThanOrEqual(PG_MAX_BIND_PARAMS);
    }
  });

  test('안전 마진을 뺀 뒤의 몫을 내림한 값을 쓴다', () => {
    // Arrange
    const columnCount = 15;

    // Act
    const size = calcChunkSize(columnCount, { maxRows: Number.MAX_SAFE_INTEGER });

    // Assert
    expect(size).toBe(Math.floor((PG_MAX_BIND_PARAMS - BIND_PARAM_RESERVE) / columnCount));
  });

  test('파라미터 여유가 남아도 행 수 상한을 넘지 않는다', () => {
    // Arrange
    const columnCount = 2;

    // Act
    const size = calcChunkSize(columnCount);

    // Assert
    expect(size).toBe(DEFAULT_MAX_ROWS_PER_CHUNK);
  });

  test('파라미터 상한에 딱 한 행만 들어가는 경계에서도 1을 반환한다', () => {
    // Arrange
    const options = { maxBindParams: 10, reserve: 0, maxRows: 100 };

    // Act
    const size = calcChunkSize(10, options);

    // Assert
    expect(size).toBe(1);
  });

  test('한 행조차 담을 수 없으면 조용히 0을 주지 않고 예외를 던진다', () => {
    // Arrange
    const options = { maxBindParams: 10, reserve: 0, maxRows: 100 };

    // Act & Assert
    expect(() => calcChunkSize(11, options)).toThrow(/한 행도 파라미터 상한/);
  });

  test.each([0, -1, 1.5, Number.NaN])('컬럼 수가 %p 이면 예외를 던진다', (columnCount) => {
    expect(() => calcChunkSize(columnCount)).toThrow(/컬럼 수는 1 이상의 정수/);
  });

  test('행 수 상한이 0 이하면 예외를 던진다', () => {
    expect(() => calcChunkSize(10, { maxRows: 0 })).toThrow(/행 수 상한은 1 이상의 정수/);
  });
});

describe('chunkRows', () => {
  test('빈 배열이면 청크를 만들지 않는다 (쿼리 자체가 실행되지 않도록)', () => {
    expect(chunkRows([], 100)).toEqual([]);
  });

  test('나누어떨어지지 않으면 마지막 청크만 짧다', () => {
    // Arrange
    const rows = [1, 2, 3, 4, 5, 6, 7];

    // Act
    const chunks = chunkRows(rows, 3);

    // Assert
    expect(chunks).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
  });

  test('모든 행이 정확히 한 번씩만 들어간다', () => {
    // Arrange
    const rows = Array.from({ length: 1000 }, (_, index) => index);

    // Act
    const chunks = chunkRows(rows, 37);

    // Assert
    expect(chunks.flat()).toEqual(rows);
    expect(chunks.every((chunk) => chunk.length <= 37)).toBe(true);
  });

  test('원본 배열을 변경하지 않는다', () => {
    // Arrange
    const rows = [1, 2, 3];
    const snapshot = [...rows];

    // Act
    chunkRows(rows, 2);

    // Assert
    expect(rows).toEqual(snapshot);
  });

  test('청크 크기가 0 이하면 예외를 던진다', () => {
    expect(() => chunkRows([1, 2], 0)).toThrow(/청크 크기는 1 이상의 정수/);
  });
});

describe('chunkByColumnCount', () => {
  test('빈 배열이면 컬럼 수 검증조차 하지 않고 빈 결과를 돌려준다', () => {
    expect(chunkByColumnCount([], 15)).toEqual([]);
  });

  test('klines(15컬럼) 5000행을 넣어도 각 청크가 파라미터 상한 안에 들어간다', () => {
    // Arrange
    const columnCount = 15;
    const rows = Array.from({ length: 5000 }, (_, index) => index);

    // Act
    const chunks = chunkByColumnCount(rows, columnCount);

    // Assert
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length * columnCount).toBeLessThanOrEqual(PG_MAX_BIND_PARAMS);
    }
    expect(chunks.flat()).toEqual(rows);
  });
});

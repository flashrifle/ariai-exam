/**
 * 배치 내부 중복 제거 테스트.
 * "ON CONFLICT DO UPDATE command cannot affect row a second time" 를 예방하는 로직이라
 * 순서 보존과 승자 선택 규칙을 정확히 고정해 둔다.
 */
import { KEY_SEPARATOR, dedupeBy, joinKey } from './dedupe';

interface Sample {
  id: string;
  version: number;
}

const keyOf = (row: Sample): string => row.id;

describe('dedupeBy', () => {
  test('빈 배열이면 빈 배열을 돌려준다', () => {
    expect(dedupeBy([], keyOf)).toEqual([]);
  });

  test('중복이 없으면 입력을 그대로 유지한다', () => {
    // Arrange
    const rows: Sample[] = [
      { id: 'a', version: 1 },
      { id: 'b', version: 1 },
    ];

    // Act
    const result = dedupeBy(rows, keyOf);

    // Assert
    expect(result).toEqual(rows);
  });

  test('기본 규칙은 나중에 온 행이 이긴다', () => {
    // Arrange
    const rows: Sample[] = [
      { id: 'a', version: 1 },
      { id: 'a', version: 2 },
    ];

    // Act
    const result = dedupeBy(rows, keyOf);

    // Assert
    expect(result).toEqual([{ id: 'a', version: 2 }]);
  });

  test('승자를 골라도 최초 등장 순서를 유지한다', () => {
    // Arrange
    const rows: Sample[] = [
      { id: 'a', version: 1 },
      { id: 'b', version: 1 },
      { id: 'a', version: 9 },
    ];

    // Act
    const result = dedupeBy(rows, keyOf, (current, incoming) =>
      incoming.version > current.version ? incoming : current,
    );

    // Assert
    expect(result.map((row) => row.id)).toEqual(['a', 'b']);
    expect(result[0]).toEqual({ id: 'a', version: 9 });
  });

  test('pickWinner가 기존 행을 고르면 나중 행은 버려진다', () => {
    // Arrange
    const rows: Sample[] = [
      { id: 'a', version: 5 },
      { id: 'a', version: 1 },
    ];

    // Act
    const result = dedupeBy(rows, keyOf, (current, incoming) =>
      incoming.version > current.version ? incoming : current,
    );

    // Assert
    expect(result).toEqual([{ id: 'a', version: 5 }]);
  });

  test('원본 배열과 행 객체를 변경하지 않는다', () => {
    // Arrange
    const rows: Sample[] = [
      { id: 'a', version: 1 },
      { id: 'a', version: 2 },
    ];
    const snapshot = JSON.stringify(rows);

    // Act
    dedupeBy(rows, keyOf);

    // Assert
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe('joinKey', () => {
  test('구분자로 조각을 이어 붙인다', () => {
    expect(joinKey('BTCUSDT', '1m', 1700000000000)).toBe(
      ['BTCUSDT', '1m', '1700000000000'].join(KEY_SEPARATOR),
    );
  });

  test('bigint도 문자열로 안전하게 변환한다', () => {
    expect(joinKey('BTCUSDT', 9007199254740993n)).toBe(`BTCUSDT${KEY_SEPARATOR}9007199254740993`);
  });

  test('조각 경계가 달라지면 키도 달라진다', () => {
    expect(joinKey('AB', 'C')).not.toBe(joinKey('A', 'BC'));
  });
});

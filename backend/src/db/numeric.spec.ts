/**
 * numeric 문자열 비교 테스트.
 * 계약 §6에 따라 부동소수 변환 없이 비교해야 하므로, Number()로는 틀리는 케이스를 함께 고정한다.
 */
import { compareNumericStrings } from './numeric';

describe('compareNumericStrings', () => {
  test.each([
    ['1', '2', -1],
    ['2', '1', 1],
    ['1', '1', 0],
    ['10', '9', 1],
    ['0.1', '0.09', 1],
    ['0.10', '0.1', 0],
    ['00012.5', '12.50', 0],
    ['-1', '1', -1],
    ['-2', '-1', -1],
    ['-0', '0', 0],
    ['.5', '0.5', 0],
    ['0', '0.00000001', -1],
  ])('compare("%s", "%s") === %i', (a, b, expected) => {
    expect(compareNumericStrings(a, b)).toBe(expected);
  });

  test('부동소수로는 구분되지 않는 8자리 소수도 정확히 가른다', () => {
    // Arrange — Number()로 변환하면 두 값이 같아지는 자릿수
    const smaller = '0.100000000000000005';
    const larger = '0.100000000000000006';

    // Act & Assert
    expect(Number(smaller)).toBe(Number(larger));
    expect(compareNumericStrings(smaller, larger)).toBe(-1);
  });

  test('정수부가 매우 길어도 자릿수 기준으로 비교한다', () => {
    expect(compareNumericStrings('123456789012345678901', '123456789012345678900')).toBe(1);
  });

  test('거래량이 0으로 채워진 표현도 동일하게 취급한다', () => {
    expect(compareNumericStrings('0.00000000', '0')).toBe(0);
  });

  test.each(['', 'abc', '1.2.3', '1e5', ' ', '-'])(
    '해석할 수 없는 값 %p 은 조용히 넘기지 않고 예외를 던진다',
    (raw) => {
      expect(() => compareNumericStrings(raw, '1')).toThrow(/numeric 문자열로 해석할 수 없습니다/);
    },
  );
});

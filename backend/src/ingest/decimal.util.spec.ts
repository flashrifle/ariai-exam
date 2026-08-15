import { mulDecimal } from './decimal.util';

describe('mulDecimal', () => {
  test('소수 곱을 자릿수 손실 없이 계산한다 (체결 quoteQty 용도)', () => {
    expect(mulDecimal('2000.50', '0.20000000')).toBe('400.1000000000');
  });

  test('정수 곱', () => {
    expect(mulDecimal('3', '4')).toBe('12');
  });

  test('부동소수로는 표현 불가한 극소값도 정확히 계산한다', () => {
    expect(mulDecimal('0.00000001', '0.00000001')).toBe('0.0000000000000001');
  });

  test('0 곱은 스케일을 유지한 0을 반환한다', () => {
    expect(mulDecimal('35000.10', '0')).toBe('0.00');
  });

  test('부동소수 오차가 나는 대표 케이스 (0.1 × 0.2)', () => {
    // parseFloat 기반이면 0.020000000000000004가 된다
    expect(mulDecimal('0.1', '0.2')).toBe('0.02');
  });

  test('십진수 형식이 아니면 예외를 던진다', () => {
    expect(() => mulDecimal('abc', '1')).toThrow('십진수 문자열이 아닙니다');
    expect(() => mulDecimal('1e5', '1')).toThrow('십진수 문자열이 아닙니다');
    expect(() => mulDecimal('', '1')).toThrow('십진수 문자열이 아닙니다');
  });
});

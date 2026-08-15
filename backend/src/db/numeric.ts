/**
 * numeric 문자열 비교 유틸.
 *
 * 계약 §6: DB의 `numeric` 은 drizzle가 **string**으로 돌려준다. Binance 역시 가격·수량을
 * 문자열로 준다. 이 값들을 `Number()` 로 바꿔 비교하면 8자리 소수에서 반올림 오차가 섞이므로,
 * 여기서는 부동소수 변환 없이 정수부/소수부를 자릿수 단위로 비교한다.
 *
 * 이 파일은 외부 의존성이 전혀 없는 순수 모듈이다(DB 없이 단위 테스트 가능).
 */

interface DecimalParts {
  /** 1 또는 -1. 값이 0이면 항상 1로 정규화한다. */
  sign: 1 | -1;
  /** 앞자리 0을 제거한 정수부. 0이면 빈 문자열. */
  integer: string;
  /** 뒷자리 0을 제거한 소수부. 0이면 빈 문자열. */
  fraction: string;
}

const DECIMAL_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** "0012.3400" → { sign: 1, integer: '12', fraction: '34' } */
function parseDecimal(raw: string): DecimalParts {
  const trimmed = raw.trim();
  const isNegative = trimmed.startsWith('-');
  const unsigned = isNegative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;

  if (!DECIMAL_PATTERN.test(unsigned)) {
    throw new Error(`numeric 문자열로 해석할 수 없습니다: "${raw}"`);
  }

  const dotIndex = unsigned.indexOf('.');
  const rawInteger = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const rawFraction = dotIndex === -1 ? '' : unsigned.slice(dotIndex + 1);

  const integer = rawInteger.replace(/^0+/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  const isZero = integer === '' && fraction === '';

  return { sign: isNegative && !isZero ? -1 : 1, integer, fraction };
}

/** 부호가 같은 두 양수 크기를 비교한다. */
function compareMagnitude(left: DecimalParts, right: DecimalParts): number {
  if (left.integer.length !== right.integer.length) {
    return left.integer.length < right.integer.length ? -1 : 1;
  }
  if (left.integer !== right.integer) {
    return left.integer < right.integer ? -1 : 1;
  }

  const width = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(width, '0');
  const rightFraction = right.fraction.padEnd(width, '0');
  if (leftFraction === rightFraction) {
    return 0;
  }
  return leftFraction < rightFraction ? -1 : 1;
}

/**
 * numeric 문자열 두 개를 비교한다.
 * @returns a < b 이면 -1, 같으면 0, a > b 이면 1
 * @throws 십진수로 해석할 수 없는 문자열이 들어온 경우
 */
export function compareNumericStrings(a: string, b: string): number {
  const left = parseDecimal(a);
  const right = parseDecimal(b);

  if (left.sign !== right.sign) {
    return left.sign < right.sign ? -1 : 1;
  }

  return compareMagnitude(left, right) * left.sign;
}

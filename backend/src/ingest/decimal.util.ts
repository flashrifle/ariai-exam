/**
 * 십진수 문자열 정밀 연산 유틸.
 *
 * 체결 스트림은 quoteQty를 주지 않으므로 price × qty로 계산해야 하는데,
 * parseFloat를 쓰면 부동소수 오차가 생긴다. BigInt 스케일링으로 정확히 곱한다.
 * (DB numeric 컬럼이 초과 소수 자릿수를 스케일에 맞춰 처리한다)
 */

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

interface ScaledDecimal {
  digits: bigint;
  scale: number;
}

function parseDecimal(value: string): ScaledDecimal {
  if (!DECIMAL_RE.test(value)) {
    throw new Error(`십진수 문자열이 아닙니다: ${value}`);
  }
  const [intPart, fracPart = ''] = value.split('.');
  return { digits: BigInt(intPart + fracPart), scale: fracPart.length };
}

function formatScaled(digits: bigint, scale: number): string {
  const negative = digits < 0n;
  const abs = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
  const intPart = abs.slice(0, abs.length - scale);
  const fracPart = scale > 0 ? `.${abs.slice(abs.length - scale)}` : '';
  return `${negative ? '-' : ''}${intPart}${fracPart}`;
}

/** 두 십진수 문자열의 정확한 곱을 문자열로 반환한다 (자릿수 손실 없음). */
export function mulDecimal(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  return formatScaled(pa.digits * pb.digits, pa.scale + pb.scale);
}

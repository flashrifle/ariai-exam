/**
 * STREAM_STATUS 이벤트 해석 유틸 (순수 함수).
 *
 * 이벤트 meta 는 `Record<string, unknown>` 이라 외부 입력과 같은 수준으로 취급한다.
 * 값이 없거나 형식이 다르면 예외를 던지지 않고 null 을 돌려 호출부가 조용히 건너뛰게 한다.
 */
import type { SupportedSymbol } from '../config/configuration';

/** ingest 가 만드는 kline 스트림 키 형식: `kline:BTCUSDT:1m` */
const KLINE_STREAM_KEY_PREFIX = 'kline:';

/**
 * kline 스트림 키에서 심볼을 뽑는다.
 *
 * 같은 STREAM_STATUS 이벤트가 스트림 수만큼(kline·trade × 심볼) 발행되므로,
 * kline 키만 통과시켜 심볼당 정확히 1회만 처리되게 한다.
 * trade 키나 알 수 없는 형식, 수집 대상이 아닌 심볼은 null 이다.
 */
export function parseSymbolFromKlineStreamKey(
  streamKey: string,
  supported: readonly SupportedSymbol[],
): SupportedSymbol | null {
  if (!streamKey.startsWith(KLINE_STREAM_KEY_PREFIX)) {
    return null;
  }
  const symbol = streamKey.slice(KLINE_STREAM_KEY_PREFIX.length).split(':')[0];
  if (symbol === undefined) {
    return null;
  }
  return supported.find((candidate) => candidate === symbol) ?? null;
}

/** ISO 8601 문자열을 Date 로 변환한다. 문자열이 아니거나 파싱 불가면 null. */
export function readIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * STREAM_STATUS 해석 테스트.
 *
 * 이 유틸이 틀리면 WS 재연결 후 다운타임 구간 강제 복구가 조용히 실행되지 않는다.
 * (증상이 "아무 일도 안 일어남"이라 운영 중에 발견하기 어렵다.)
 */
import { parseSymbolFromKlineStreamKey, readIsoDate } from './stream-status.util';

const SUPPORTED = ['BTCUSDT', 'ETHUSDT'] as const;

describe('parseSymbolFromKlineStreamKey', () => {
  test('kline 스트림 키에서 심볼을 뽑는다', () => {
    expect(parseSymbolFromKlineStreamKey('kline:BTCUSDT:1m', SUPPORTED)).toBe('BTCUSDT');
    expect(parseSymbolFromKlineStreamKey('kline:ETHUSDT:1m', SUPPORTED)).toBe('ETHUSDT');
  });

  test('trade 스트림은 제외한다 — 같은 구간이 심볼당 두 번 복구되는 것을 막는다', () => {
    expect(parseSymbolFromKlineStreamKey('trade:BTCUSDT', SUPPORTED)).toBeNull();
  });

  test('수집 대상이 아닌 심볼은 제외한다', () => {
    expect(parseSymbolFromKlineStreamKey('kline:DOGEUSDT:1m', SUPPORTED)).toBeNull();
  });

  test('형식이 어긋나면 예외 대신 null 을 돌려준다', () => {
    expect(parseSymbolFromKlineStreamKey('', SUPPORTED)).toBeNull();
    expect(parseSymbolFromKlineStreamKey('kline:', SUPPORTED)).toBeNull();
    expect(parseSymbolFromKlineStreamKey('BTCUSDT', SUPPORTED)).toBeNull();
  });
});

describe('readIsoDate', () => {
  test('ISO 문자열을 Date 로 변환한다', () => {
    const iso = '2026-08-15T10:40:00.000Z';

    expect(readIsoDate(iso)).toEqual(new Date(iso));
  });

  test('문자열이 아니거나 파싱 불가면 null — meta 는 외부 입력과 같이 취급한다', () => {
    expect(readIsoDate(undefined)).toBeNull();
    expect(readIsoDate(null)).toBeNull();
    expect(readIsoDate(1_755_254_400_000)).toBeNull();
    expect(readIsoDate('yesterday')).toBeNull();
    expect(readIsoDate({ at: '2026-08-15T10:40:00.000Z' })).toBeNull();
  });
});

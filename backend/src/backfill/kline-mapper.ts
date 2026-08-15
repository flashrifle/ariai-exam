/**
 * BinanceRestClient 가 돌려주는 도메인 캔들(BinanceKline) → klines upsert 행 변환 (순수 함수).
 * 구조 검증은 클라이언트의 zod 스키마가 이미 수행하므로, 여기서는
 * 분 경계 불변조건(CONTRACT 7절)과 미확정 봉 여부만 한 번 더 방어한다.
 */
import type { BinanceKline } from '../binance/binance-rest.schemas';
import type { KlineInsert } from '../db/schema';

/**
 * REST 캔들을 klines 테이블 upsert 행으로 변환한다.
 * - 가격/수량은 문자열 그대로 유지 (parseFloat 금지 — numeric 정밀도 보존)
 * - open_time 분 경계 정렬(ss.mmm = 00.000) 불변조건을 검증
 * - source 는 항상 'rest'
 */
export function toKlineInsert(
  symbol: string,
  interval: string,
  kline: BinanceKline,
  stepMs: number,
): KlineInsert {
  const openTimeMs = kline.openTime.getTime();
  if (openTimeMs % stepMs !== 0) {
    throw new Error(`open_time 이 분 경계에 정렬되지 않았습니다: ${openTimeMs} (${symbol})`);
  }
  return {
    symbol,
    interval,
    openTime: kline.openTime,
    closeTime: kline.closeTime,
    open: kline.open,
    high: kline.high,
    low: kline.low,
    close: kline.close,
    volume: kline.volume,
    quoteVolume: kline.quoteVolume,
    tradeCount: kline.tradeCount,
    takerBuyBase: kline.takerBuyBase,
    takerBuyQuote: kline.takerBuyQuote,
    source: 'rest',
  };
}

/**
 * 봉이 이미 닫혔는지 판정한다. open_time + 봉 길이가 현재 시각 이후면 아직 진행 중이므로
 * 저장 대상이 아니다 (아직 닫히지 않은 마지막 봉 저장 금지).
 */
export function isClosedCandle(kline: BinanceKline, stepMs: number, nowMs: number): boolean {
  return kline.openTime.getTime() + stepMs <= nowMs;
}

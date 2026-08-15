/**
 * Binance combined stream 메시지 파서.
 *
 * WS 원문(JSON 문자열)을 zod로 검증해 이벤트 계약(common/events.ts)의
 * 도메인 페이로드로 변환한다. 가격/수량은 문자열 그대로 유지하고,
 * 1분봉 openTime의 분 경계 정렬 불변조건(계약 7절)을 여기서 검증한다.
 */
import { z } from 'zod';
import { decimalStringSchema, isMinuteAligned } from '../binance/binance-rest.schemas';
import type { KlinePayload, TradePayload } from '../common/events';
import { BASE_INTERVAL, SUPPORTED_SYMBOLS, type SupportedSymbol } from '../config/configuration';
import { mulDecimal } from './decimal.util';

const symbolSchema = z.enum(SUPPORTED_SYMBOLS);

/** <symbol>@kline_1m 이벤트. 필요한 필드만 파싱한다. */
const klineEventSchema = z.object({
  e: z.literal('kline'),
  E: z.number().int(), // 이벤트 시각 (epoch ms)
  s: symbolSchema,
  k: z.object({
    t: z.number().int(), // openTime
    T: z.number().int(), // closeTime
    s: symbolSchema,
    i: z.literal(BASE_INTERVAL), // 저장 기준 인터벌은 1m 고정
    o: decimalStringSchema,
    c: decimalStringSchema,
    h: decimalStringSchema,
    l: decimalStringSchema,
    v: decimalStringSchema, // base volume
    n: z.number().int(), // trade count
    x: z.boolean(), // 봉 확정 여부
    q: decimalStringSchema, // quote volume
    V: decimalStringSchema, // taker buy base
    Q: decimalStringSchema, // taker buy quote
  }),
});

/** <symbol>@trade 이벤트. */
const tradeEventSchema = z.object({
  e: z.literal('trade'),
  E: z.number().int(),
  s: symbolSchema,
  t: z.number().int(), // trade id
  p: decimalStringSchema,
  q: decimalStringSchema,
  T: z.number().int(), // 체결 시각 (epoch ms)
  m: z.boolean(), // 매수자가 maker인지
});

const combinedFrameSchema = z.object({
  stream: z.string(),
  data: z.discriminatedUnion('e', [klineEventSchema, tradeEventSchema]),
});

export interface ParsedKlineMessage {
  type: 'kline';
  /** 거래소 이벤트 시각(E) — ingest_state.lastEventTime 갱신용. */
  eventTime: Date;
  payload: KlinePayload;
}

export interface ParsedTradeMessage {
  type: 'trade';
  eventTime: Date;
  payload: TradePayload;
}

export type ParsedStreamMessage = ParsedKlineMessage | ParsedTradeMessage;

/** ingest_state.stream_key 규칙: 'kline:BTCUSDT:1m'. */
export function klineStreamKey(symbol: SupportedSymbol): string {
  return `kline:${symbol}:${BASE_INTERVAL}`;
}

/** ingest_state.stream_key 규칙: 'trade:BTCUSDT'. */
export function tradeStreamKey(symbol: SupportedSymbol): string {
  return `trade:${symbol}`;
}

/**
 * combined stream 원문 한 건을 파싱한다.
 * 형식이 계약과 다르면 예외를 던진다 (호출자가 개수 집계 후 로깅).
 */
export function parseStreamMessage(raw: string): ParsedStreamMessage {
  const frame = combinedFrameSchema.parse(JSON.parse(raw));
  if (frame.data.e === 'kline') {
    return toKlineMessage(frame.data);
  }
  return toTradeMessage(frame.data);
}

function toKlineMessage(event: z.infer<typeof klineEventSchema>): ParsedKlineMessage {
  const k = event.k;
  if (!isMinuteAligned(k.t)) {
    throw new Error(`1분봉 openTime이 분 경계에 정렬되지 않았습니다: ${k.t}`);
  }
  return {
    type: 'kline',
    eventTime: new Date(event.E),
    payload: {
      symbol: k.s,
      interval: BASE_INTERVAL,
      openTime: new Date(k.t),
      closeTime: new Date(k.T),
      open: k.o,
      high: k.h,
      low: k.l,
      close: k.c,
      volume: k.v,
      quoteVolume: k.q,
      tradeCount: k.n,
      takerBuyBase: k.V,
      takerBuyQuote: k.Q,
      isClosed: k.x,
    },
  };
}

function toTradeMessage(event: z.infer<typeof tradeEventSchema>): ParsedTradeMessage {
  return {
    type: 'trade',
    eventTime: new Date(event.E),
    payload: {
      symbol: event.s,
      tradeId: BigInt(event.t),
      price: event.p,
      qty: event.q,
      // 스트림은 quoteQty를 주지 않으므로 BigInt 스케일 곱으로 정확히 계산한다
      quoteQty: mulDecimal(event.p, event.q),
      tradeTime: new Date(event.T),
      isBuyerMaker: event.m,
    },
  };
}

/**
 * Binance REST 응답 zod 스키마 + 도메인 매퍼.
 *
 * Binance는 kline을 "배열의 배열"(튜플)로 주므로 튜플 스키마로 엄격히 파싱하고,
 * 가격/수량은 부동소수 오차를 피하기 위해 문자열 그대로 유지한다.
 * 요청 weight 규칙도 REST 계약의 일부이므로 여기에 함께 정의한다.
 */
import { z } from 'zod';
import { BASE_INTERVAL, BASE_INTERVAL_MS } from '../config/configuration';

/** Binance가 주는 십진수 문자열 (예: "35000.10000000"). parseFloat 금지. */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, '십진수 문자열이어야 합니다');

/** epoch ms가 1분 경계(ss.mmm = 00.000)에 정렬됐는지 검증한다 (계약 7절 불변조건). */
export function isMinuteAligned(epochMs: number): boolean {
  return epochMs % BASE_INTERVAL_MS === 0;
}

// ── klines ──────────────────────────────────────────────────────────────

/**
 * GET /api/v3/klines 응답의 캔들 1개.
 * [openTime, open, high, low, close, volume, closeTime, quoteVolume,
 *  tradeCount, takerBuyBase, takerBuyQuote, (미사용)]
 */
export const klineTupleSchema = z.tuple([
  z.number().int(), // 0: openTime (epoch ms)
  decimalStringSchema, // 1: open
  decimalStringSchema, // 2: high
  decimalStringSchema, // 3: low
  decimalStringSchema, // 4: close
  decimalStringSchema, // 5: volume (base)
  z.number().int(), // 6: closeTime (epoch ms)
  decimalStringSchema, // 7: quoteVolume
  z.number().int(), // 8: tradeCount
  decimalStringSchema, // 9: takerBuyBase
  decimalStringSchema, // 10: takerBuyQuote
  z.string(), // 11: 미사용 필드
]);

export const klinesResponseSchema = z.array(klineTupleSchema);

export type KlineTuple = z.infer<typeof klineTupleSchema>;

/** REST 캔들 도메인 객체. 시각은 UTC Date, 가격/수량은 문자열 유지. */
export interface BinanceKline {
  openTime: Date;
  closeTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradeCount: number;
  takerBuyBase: string;
  takerBuyQuote: string;
}

/** 튜플 → 도메인 객체. 1분봉이면 분 경계 정렬 불변조건을 검증한다. */
export function mapKlineTuple(tuple: KlineTuple, interval: string): BinanceKline {
  const openTimeMs = tuple[0];
  if (interval === BASE_INTERVAL && !isMinuteAligned(openTimeMs)) {
    throw new Error(`1분봉 openTime이 분 경계에 정렬되지 않았습니다: ${openTimeMs}`);
  }
  return {
    openTime: new Date(openTimeMs),
    closeTime: new Date(tuple[6]),
    open: tuple[1],
    high: tuple[2],
    low: tuple[3],
    close: tuple[4],
    volume: tuple[5],
    quoteVolume: tuple[7],
    tradeCount: tuple[8],
    takerBuyBase: tuple[9],
    takerBuyQuote: tuple[10],
  };
}

// ── aggTrades ───────────────────────────────────────────────────────────

/** GET /api/v3/aggTrades 응답의 체결 1건. 필요 필드만 파싱한다 (나머지는 무시). */
export const aggTradeSchema = z.object({
  a: z.number().int(), // 집계 체결 ID
  p: decimalStringSchema, // 가격
  q: decimalStringSchema, // 수량
  f: z.number().int(), // 첫 개별 체결 ID
  l: z.number().int(), // 마지막 개별 체결 ID
  T: z.number().int(), // 체결 시각 (epoch ms)
  m: z.boolean(), // 매수자가 maker인지
});

export const aggTradesResponseSchema = z.array(aggTradeSchema);

export type AggTradeRaw = z.infer<typeof aggTradeSchema>;

/** REST 체결 도메인 객체. ID는 bigint (DB trade_id 컬럼과 동일 표현). */
export interface BinanceAggTrade {
  aggTradeId: bigint;
  price: string;
  qty: string;
  firstTradeId: bigint;
  lastTradeId: bigint;
  tradeTime: Date;
  isBuyerMaker: boolean;
}

export function mapAggTrade(raw: AggTradeRaw): BinanceAggTrade {
  return {
    aggTradeId: BigInt(raw.a),
    price: raw.p,
    qty: raw.q,
    firstTradeId: BigInt(raw.f),
    lastTradeId: BigInt(raw.l),
    tradeTime: new Date(raw.T),
    isBuyerMaker: raw.m,
  };
}

// ── server time ─────────────────────────────────────────────────────────

export const serverTimeResponseSchema = z.object({
  serverTime: z.number().int(),
});

// ── weight 규칙 (계약 3절) ───────────────────────────────────────────────

export const MAX_KLINES_LIMIT = 1_000;
export const MAX_AGG_TRADES_LIMIT = 1_000;
/** /api/v3/aggTrades 고정 weight. */
export const AGG_TRADES_WEIGHT = 2;
/** /api/v3/time 고정 weight. */
export const SERVER_TIME_WEIGHT = 1;

/** /api/v3/klines: limit≤100 → 1, ≤500 → 2, ≤1000 → 5. */
export function klinesWeightForLimit(limit: number): number {
  if (limit <= 100) {
    return 1;
  }
  if (limit <= 500) {
    return 2;
  }
  return 5;
}

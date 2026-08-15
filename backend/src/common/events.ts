/**
 * 모듈 간 이벤트 계약 (@nestjs/event-emitter).
 * 발행자와 구독자가 서로를 직접 import 하지 않도록 페이로드를 여기서만 정의한다.
 */
import type { SupportedInterval, SupportedSymbol } from '../config/configuration';

export const AppEvents = {
  /** 1분봉 수신 (미확정 봉 포함). */
  KLINE_UPDATED: 'kline.updated',
  /** 1분봉 확정. 지표 재계산 트리거. */
  KLINE_CLOSED: 'kline.closed',
  /** 개별 체결 수신. */
  TRADE_RECEIVED: 'trade.received',
  /** WS 연결 상태 변화. */
  STREAM_STATUS: 'stream.status',
  /** 갭 탐지. */
  GAP_DETECTED: 'gap.detected',
  /** 백필 진행 상황 변화. */
  BACKFILL_PROGRESS: 'backfill.progress',
} as const;

export interface KlinePayload {
  symbol: SupportedSymbol;
  interval: SupportedInterval;
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
  isClosed: boolean;
}

export interface TradePayload {
  symbol: SupportedSymbol;
  tradeId: bigint;
  price: string;
  qty: string;
  quoteQty: string;
  tradeTime: Date;
  isBuyerMaker: boolean;
}

export interface StreamStatusPayload {
  streamKey: string;
  connected: boolean;
  /** 'ws_open' | 'ws_close' | 'ws_error' | 'reconnect' */
  reason: string;
  at: Date;
  meta?: Record<string, unknown>;
}

export interface GapDetectedPayload {
  symbol: SupportedSymbol;
  interval: SupportedInterval;
  from: Date;
  to: Date;
  missingCount: number;
}

export interface BackfillProgressPayload {
  jobId: number;
  symbol: SupportedSymbol;
  interval: SupportedInterval;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  rowsWritten: number;
  error?: string;
}

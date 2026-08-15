/**
 * 이벤트 버스 페이로드 → SSE 프레임 변환 (순수 함수).
 *
 * 내부 페이로드는 numeric 을 string 으로 들고 다니지만, SSE 로 나가는 값은
 * `frontend/src/types/api.ts` 계약대로 number / ISO8601 문자열이어야 한다.
 */
import type { MessageEvent } from '@nestjs/common';
import { toIsoString, toNumber } from '../common/coerce.util';
import type { KlinePayload, TradePayload } from '../common/events';
import type {
  CandleEvent,
  MetricsEvent,
  MetricsOverview,
  OpsEvent,
  OpsHealth,
  TickEvent,
} from '../api/dto/api-types';
import { SSE_EVENTS, SSE_RETRY_MS } from './realtime.constants';

/** 체결 → `tick` */
export function toTickMessage(payload: TradePayload): MessageEvent {
  const data: TickEvent = {
    symbol: payload.symbol,
    price: toNumber(payload.price),
    qty: toNumber(payload.qty),
    isBuyerMaker: payload.isBuyerMaker,
    tradeTime: toIsoString(payload.tradeTime),
  };
  return { type: SSE_EVENTS.TICK, data };
}

/** 1분봉 갱신/확정 → `candle` */
export function toCandleMessage(payload: KlinePayload): MessageEvent {
  const data: CandleEvent = {
    symbol: payload.symbol,
    interval: payload.interval,
    isClosed: payload.isClosed,
    candle: {
      openTime: toIsoString(payload.openTime),
      closeTime: toIsoString(payload.closeTime),
      open: toNumber(payload.open),
      high: toNumber(payload.high),
      low: toNumber(payload.low),
      close: toNumber(payload.close),
      volume: toNumber(payload.volume),
      quoteVolume: toNumber(payload.quoteVolume),
      tradeCount: payload.tradeCount,
      takerBuyQuote: toNumber(payload.takerBuyQuote),
    },
  };
  return { type: SSE_EVENTS.CANDLE, data };
}

/** 지표 스냅샷 → `metrics` */
export function toMetricsMessage(overview: MetricsOverview): MessageEvent {
  const data: MetricsEvent = { overview };
  return { type: SSE_EVENTS.METRICS, data };
}

/** 수집 상태/백필 진행 → `ops` */
export function toOpsMessage(health: OpsHealth): MessageEvent {
  const data: OpsEvent = { health };
  return { type: SSE_EVENTS.OPS, data };
}

/** 하트비트. `retry` 로 클라이언트 재연결 대기시간도 함께 알려준다. */
export function toPingMessage(now: Date): MessageEvent {
  return {
    type: SSE_EVENTS.PING,
    data: { ts: now.toISOString() },
    retry: SSE_RETRY_MS,
  };
}

/**
 * 지표 모듈이 이벤트로 밀어준 값에서 `MetricsOverview` 를 꺼낸다.
 * `MetricsOverview` 그대로 오든 `{ overview }` 로 감싸서 오든 모두 받아들이고,
 * 형태가 어긋나면 null 을 돌려 조용히 버린다(잘못된 프레임을 프론트로 흘리지 않는다).
 */
export function extractOverview(payload: unknown): MetricsOverview | null {
  const record = asRecord(payload);
  if (record === null) {
    return null;
  }
  const candidate = asRecord(record.overview) ?? record;
  const looksValid =
    typeof candidate.symbol === 'string' &&
    typeof candidate.asOf === 'string' &&
    typeof candidate.lastPrice === 'number';

  return looksValid ? (candidate as unknown as MetricsOverview) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

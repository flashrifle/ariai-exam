/**
 * 스트림 건강도 변환 (순수 함수).
 * `lagSeconds` 는 응답을 만드는 시점 기준으로 항상 다시 계산한다 — 캐시된 값이 남으면 지연을 놓친다.
 */
import { SUPPORTED_SYMBOLS } from '../../config/configuration';
import type { SupportedSymbol } from '../../config/configuration';
import { elapsedSeconds, toNullableIsoString } from '../../common/coerce.util';
import type { StreamHealthSnapshot } from '../../common/ports';
import type { StreamHealth } from '../dto/api-types';

/** 이 시간(초) 이상 이벤트가 없으면 연결이 살아 있어도 '수신 중'으로 보지 않는다. */
export const STREAM_STALE_THRESHOLD_SEC = 90;

export interface ParsedStreamKey {
  kind: 'kline' | 'trade';
  symbol: SupportedSymbol;
}

/**
 * `kline:BTCUSDT:1m` / `trade:BTCUSDT` 형태의 streamKey 를 해석한다.
 * 형식이 다르면 null 을 돌려 호출부가 건너뛰게 한다.
 */
export function parseStreamKey(streamKey: string): ParsedStreamKey | null {
  const [kind, symbol] = streamKey.split(':');
  if (kind !== 'kline' && kind !== 'trade') {
    return null;
  }
  if (!(SUPPORTED_SYMBOLS as readonly string[]).includes(symbol ?? '')) {
    return null;
  }
  return { kind, symbol: symbol as SupportedSymbol };
}

/** ingest 스냅샷 → 프론트 계약(StreamHealth). */
export function toStreamHealth(snapshot: StreamHealthSnapshot, now: Date): StreamHealth {
  const lastEventAt = toNullableIsoString(snapshot.lastEventAt);
  const lagSeconds =
    lastEventAt === null ? (snapshot.lagSeconds ?? null) : elapsedSeconds(new Date(lastEventAt), now);

  return {
    streamKey: snapshot.streamKey,
    symbol: snapshot.symbol,
    kind: snapshot.kind,
    connected: snapshot.connected,
    lastEventAt,
    lagSeconds,
  };
}

/**
 * ingest 모듈이 아직 붙지 않았을 때 `ingest_state` 로부터 만드는 대체 스냅샷.
 * WS 연결 여부를 알 수 없으므로 "최근에 데이터가 들어왔는가"를 connected 의 근사치로 쓴다.
 */
export function fallbackStreamHealth(
  streamKey: string,
  lastEventTime: unknown,
  now: Date,
): StreamHealth | null {
  const parsed = parseStreamKey(streamKey);
  if (parsed === null) {
    return null;
  }
  const lastEventAt = toNullableIsoString(lastEventTime);
  const lagSeconds = lastEventAt === null ? null : elapsedSeconds(new Date(lastEventAt), now);

  return {
    streamKey,
    symbol: parsed.symbol,
    kind: parsed.kind,
    connected: lagSeconds !== null && lagSeconds < STREAM_STALE_THRESHOLD_SEC,
    lastEventAt,
    lagSeconds,
  };
}

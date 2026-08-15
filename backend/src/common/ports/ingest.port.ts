/**
 * 실시간 수집 모듈(ingest) 연동 포트.
 *
 * app.module.ts 바인딩 예:
 *   { provide: INGEST_PORT, useExisting: IngestService }
 */
import type { SupportedSymbol } from '../../config/configuration';

export const INGEST_PORT = Symbol('INGEST_PORT');

/**
 * 스트림 1개의 수집 상태 스냅샷.
 * `lagSeconds` 는 API 레이어가 응답 시각 기준으로 다시 계산하므로 선택 항목이다.
 */
export interface StreamHealthSnapshot {
  /** 예: 'kline:BTCUSDT:1m', 'trade:BTCUSDT' */
  streamKey: string;
  symbol: SupportedSymbol;
  kind: 'kline' | 'trade';
  connected: boolean;
  lastEventAt: Date | string | null;
  lagSeconds?: number | null;
}

export interface IngestPort {
  /** WS 연결 상태와 마지막 수신 시각. 동기/비동기 구현 모두 허용한다. */
  getStreamHealth(): StreamHealthSnapshot[] | Promise<StreamHealthSnapshot[]>;
}

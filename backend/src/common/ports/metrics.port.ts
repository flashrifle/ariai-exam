/**
 * 지표 모듈(metrics) 연동 포트.
 *
 * API/SSE 레이어는 `MetricsService` 구현을 직접 import 하지 않고 이 토큰으로만 주입받는다.
 * 덕분에 모듈이 동시에 개발돼도 서로의 컴파일을 깨뜨리지 않고, 유닛 테스트에서 mock 하기 쉽다.
 *
 * app.module.ts 바인딩 예:
 *   { provide: METRICS_PORT, useExisting: MetricsService }
 */
import type { SupportedSymbol } from '../../config/configuration';
import type { MetricSeries, MetricsOverview } from '../../api/dto/api-types';

export const METRICS_PORT = Symbol('METRICS_PORT');

export interface MetricsSeriesQuery {
  symbol: SupportedSymbol;
  /** 지표 식별자 (예: 'vwap', 'realizedVolatility'). */
  metric: string;
  /** 조회 윈도우 (예: '1h', '24h'). */
  window: string;
}

export interface MetricsPort {
  /** 지표 카드용 최신 스냅샷. */
  getOverview(symbol: SupportedSymbol): Promise<MetricsOverview>;
  /** 지표 시계열. 지원하지 않는 metric 이면 예외를 던진다. */
  getSeries(query: MetricsSeriesQuery): Promise<MetricSeries>;
}

/**
 * 지표 모듈 출력 계약.
 *
 * frontend/src/types/api.ts 의 `MetricsOverview` / `MetricSeries` 와
 * 필드명·의미가 1:1 로 일치해야 한다 (docs/CONTRACT.md 5절).
 * 백엔드는 프론트 소스를 import 할 수 없으므로 여기에 동일한 형태로 정의하고,
 * 프론트 타입이 바뀌면 이 파일도 함께 맞춘다.
 */
import type { SupportedSymbol } from '../config/configuration';

/** 캔들 1개. 1m 은 원본, 5m/15m/1h 는 SQL 파생 집계 결과다. */
export interface MetricsOverview {
  symbol: SupportedSymbol;
  /** 스냅샷 계산 시각 (DB now(), ISO 8601 UTC) */
  asOf: string;
  /** 최신 체결가 */
  lastPrice: number;
  /** 24시간 전 대비 변화율 (%) */
  priceChangePct24h: number;
  /** 24시간 거래대금 (USDT) */
  quoteVolume24h: number;
  /** 최근 N분 거래량가중평균가 = Σ(quoteVolume) / Σ(volume) */
  vwap: number;
  /** (lastPrice - vwap) / vwap × 100 (%) */
  vwapDeviationPct: number;
  /** 1분 로그수익률 표본표준편차 × √525600 × 100 (%) */
  realizedVolatility: number;
  /** Σ(takerBuyQuote) / Σ(quoteVolume), 0~1 */
  takerBuyRatio: number;
  /** 최근 1분 체결 건수 */
  tradeCount1m: number;
  /** 최근 N분 거래대금 ÷ 직전 동일 길이 구간 거래대금 */
  volumeSurgeRatio: number;
}

export interface MetricPoint {
  ts: string;
  value: number;
}

export interface MetricSeries {
  symbol: SupportedSymbol;
  metric: string;
  /** 정규화된 윈도우 표기 (예: '60m') */
  window: string;
  points: MetricPoint[];
}

/**
 * DB 가 반환하는 원시 스칼라 값.
 * numeric → string, count(*)::bigint → string, ::int → number, NULL → null.
 */
export type SqlScalar = string | number | null;

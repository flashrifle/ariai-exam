/**
 * 지표 서비스 — API 담당자가 import 하는 공개 진입점.
 *
 * - getOverview: 캐시(MetricsCacheService)에서 스냅샷 반환. 요청마다 집계하지 않는다.
 * - getCandles: 1m 원본 / 5m·15m·1h SQL 파생 집계 (candle-aggregation.ts).
 * - getSeries: 1분 단위 지표 시계열 (series.query.ts).
 * 입력(심볼·인터벌·지표·윈도우)은 전부 이 경계에서 검증한다.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SUPPORTED_INTERVALS,
  SUPPORTED_SYMBOLS,
  type SupportedInterval,
  type SupportedSymbol,
} from '../config/configuration';
import { DRIZZLE, type Database } from '../db/db.tokens';
import { buildCandlesQuery, mapCandleRow, type CandleRow } from './candle-aggregation';
import { MetricsCacheService } from './metrics-cache.service';
import { parseWindowToMinutes } from './metrics-math';
import { resolveMetricsConfig, type MetricsRuntimeConfig } from './metrics.config';
import {
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  SERIES_METRICS,
  type SeriesMetric,
} from './metrics.constants';
import type { Candle, MetricSeries, MetricsOverview } from './metrics.types';
import { buildSeriesQuery, mapSeriesRows, type SeriesRow } from './series.query';

@Injectable()
export class MetricsService {
  private readonly config: MetricsRuntimeConfig;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly cache: MetricsCacheService,
    configService: ConfigService,
  ) {
    this.config = resolveMetricsConfig(configService);
  }

  /** 지표 카드 스냅샷 — GET /metrics/overview?symbol */
  async getOverview(symbol: string): Promise<MetricsOverview> {
    return this.cache.getOverview(assertSymbol(symbol));
  }

  /** 캔들 시계열(시간 오름차순) — GET /candles?symbol&interval&limit */
  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    const validSymbol = assertSymbol(symbol);
    const validInterval = assertInterval(interval);
    const result = await this.db.execute(
      buildCandlesQuery(validSymbol, validInterval, clampLimit(limit)),
    );
    return (result.rows as unknown as CandleRow[]).map(mapCandleRow);
  }

  /** 지표 시계열 — GET /metrics/series?symbol&metric&window */
  async getSeries(symbol: string, metric: string, window?: string): Promise<MetricSeries> {
    const validSymbol = assertSymbol(symbol);
    const validMetric = assertMetric(metric);
    const minutes = parseWindowToMinutes(window, this.config.windowMinutes);
    if (minutes === null) {
      throw new BadRequestException(
        `잘못된 window 형식입니다: '${window ?? ''}' (예: 60, 60m, 24h, 1d)`,
      );
    }
    const result = await this.db.execute(buildSeriesQuery(validSymbol, validMetric, minutes));
    return {
      symbol: validSymbol,
      metric: validMetric,
      window: `${minutes}m`,
      points: mapSeriesRows(result.rows as unknown as SeriesRow[]),
    };
  }
}

/** 심볼 검증. 시스템 경계이므로 외부 입력을 신뢰하지 않는다. */
function assertSymbol(symbol: string): SupportedSymbol {
  const normalized = symbol.trim().toUpperCase();
  if ((SUPPORTED_SYMBOLS as readonly string[]).includes(normalized)) {
    return normalized as SupportedSymbol;
  }
  throw new BadRequestException(`지원하지 않는 심볼입니다: ${symbol}`);
}

function assertInterval(interval: string): SupportedInterval {
  if ((SUPPORTED_INTERVALS as readonly string[]).includes(interval)) {
    return interval as SupportedInterval;
  }
  throw new BadRequestException(
    `지원하지 않는 인터벌입니다: ${interval} (지원: ${SUPPORTED_INTERVALS.join(', ')})`,
  );
}

function assertMetric(metric: string): SeriesMetric {
  if ((SERIES_METRICS as readonly string[]).includes(metric)) {
    return metric as SeriesMetric;
  }
  throw new BadRequestException(
    `지원하지 않는 지표입니다: ${metric} (지원: ${SERIES_METRICS.join(', ')})`,
  );
}

function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_CANDLE_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_CANDLE_LIMIT);
}

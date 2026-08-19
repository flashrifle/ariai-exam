/**
 * 지표 서비스 — API 담당자가 import 하는 공개 진입점.
 *
 * - getOverview: 캐시(MetricsCacheService)에서 스냅샷 반환. 요청마다 집계하지 않는다.
 * - getSeries: 1분 단위 지표 시계열 (series.query.ts).
 * 입력(심볼·지표·윈도우)은 전부 이 경계에서 검증한다.
 *
 * 캔들 조회는 `api/candles` 가 소유한다 — 같은 파생 집계를 두 벌 두면 한쪽만 고쳐져 값이 갈라진다.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from '../config/configuration';
import type { MetricsPort, MetricsSeriesQuery } from '../common/ports';
import { DRIZZLE, type Database } from '../db/db.tokens';
import { MetricsCacheService } from './metrics-cache.service';
import { parseWindowToMinutes } from './metrics-math';
import { resolveMetricsConfig, type MetricsRuntimeConfig } from './metrics.config';
import { SERIES_METRICS, type SeriesMetric } from './metrics.constants';
import type { MetricSeries, MetricsOverview } from './metrics.types';
import { buildSeriesQuery, mapSeriesRows, type SeriesRow } from './series.query';

@Injectable()
// MetricsPort 를 명시적으로 구현해 API 레이어와의 시그니처 불일치를 컴파일 단계에서 잡는다.
export class MetricsService implements MetricsPort {
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

  /**
   * 지표 시계열 — GET /metrics/series?symbol&metric&window
   *
   * 인자는 MetricsPort 계약에 맞춰 객체 하나로 받는다.
   * (호출부인 API 레이어가 포트 타입으로 주입받으므로 시그니처가 어긋나면 컴파일이 깨져야 한다.)
   */
  async getSeries({ symbol, metric, window }: MetricsSeriesQuery): Promise<MetricSeries> {
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

function assertMetric(metric: string): SeriesMetric {
  if ((SERIES_METRICS as readonly string[]).includes(metric)) {
    return metric as SeriesMetric;
  }
  throw new BadRequestException(
    `지원하지 않는 지표입니다: ${metric} (지원: ${SERIES_METRICS.join(', ')})`,
  );
}

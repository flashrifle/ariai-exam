import {
  Controller,
  Get,
  Inject,
  Optional,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SUPPORTED_SYMBOLS } from '../../config/configuration';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { METRICS_PORT } from '../../common/ports';
import type { MetricsPort } from '../../common/ports';
import type { MetricSeries, MetricsOverview } from '../dto/api-types';
import { MetricSeriesModel, MetricsOverviewModel } from '../dto/swagger.market.models';
import { ApiEnvelopeOkResponse } from '../dto/swagger.helpers';
import { metricsOverviewQuerySchema, metricsSeriesQuerySchema } from '../dto/query.schemas';
import type { MetricsOverviewQuery, MetricsSeriesQuery } from '../dto/query.schemas';

/** 실제 경로: `/api/v1/metrics/*` (전역 prefix 는 main.ts). */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(
    @Optional() @Inject(METRICS_PORT) private readonly metrics: MetricsPort | null = null,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '지표 카드용 스냅샷' })
  @ApiQuery({ name: 'symbol', enum: SUPPORTED_SYMBOLS, required: true })
  @ApiEnvelopeOkResponse(MetricsOverviewModel)
  @ApiBadRequestResponse({ description: '지원하지 않는 symbol' })
  getOverview(
    @Query(new ZodValidationPipe(metricsOverviewQuerySchema)) query: MetricsOverviewQuery,
  ): Promise<MetricsOverview> {
    return this.requireMetrics().getOverview(query.symbol);
  }

  @Get('series')
  @ApiOperation({
    summary: '지표 시계열',
    description: "metric 은 지표 식별자(예: 'vwap'), window 는 숫자+단위(예: '1h', '24h').",
  })
  @ApiQuery({ name: 'symbol', enum: SUPPORTED_SYMBOLS, required: true })
  @ApiQuery({ name: 'metric', required: true, example: 'vwap' })
  @ApiQuery({ name: 'window', required: false, example: '1h', description: '기본값 1h' })
  @ApiEnvelopeOkResponse(MetricSeriesModel)
  @ApiBadRequestResponse({ description: '지원하지 않는 symbol/metric/window' })
  getSeries(
    @Query(new ZodValidationPipe(metricsSeriesQuerySchema)) query: MetricsSeriesQuery,
  ): Promise<MetricSeries> {
    return this.requireMetrics().getSeries(query);
  }

  /** 지표 모듈이 아직 바인딩되지 않았다면 500 이 아니라 503 으로 명확히 알린다. */
  private requireMetrics(): MetricsPort {
    if (this.metrics === null) {
      throw new ServiceUnavailableException('지표 서비스가 아직 준비되지 않았습니다');
    }
    return this.metrics;
  }
}

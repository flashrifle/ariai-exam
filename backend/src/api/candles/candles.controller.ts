import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from '../../config/configuration';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { Candle } from '../dto/api-types';
import { CandleModel } from '../dto/swagger.market.models';
import { ApiEnvelopeOkResponse } from '../dto/swagger.helpers';
import {
  CANDLE_LIMIT_DEFAULT,
  CANDLE_LIMIT_MAX,
  candlesQuerySchema,
} from '../dto/query.schemas';
import type { CandlesQuery } from '../dto/query.schemas';
import { CandlesService } from './candles.service';

/** 전역 prefix `api/v1` 은 main.ts 에서 설정한다 → 실제 경로는 `/api/v1/candles`. */
@ApiTags('candles')
@Controller('candles')
export class CandlesController {
  constructor(private readonly candlesService: CandlesService) {}

  @Get()
  @ApiOperation({
    summary: '캔들 시계열 조회',
    description:
      '1분봉을 원본으로 저장하고, 5m/15m/1h 는 SQL(date_bin) 집계로 파생한다. 최신 봉이 마지막(오름차순)이다.',
  })
  @ApiQuery({ name: 'symbol', enum: SUPPORTED_SYMBOLS, required: true })
  @ApiQuery({
    name: 'interval',
    enum: SUPPORTED_INTERVALS,
    required: false,
    description: `기본값 1m`,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: CANDLE_LIMIT_MAX, default: CANDLE_LIMIT_DEFAULT },
    description: `반환할 봉 개수 (최대 ${CANDLE_LIMIT_MAX})`,
  })
  @ApiEnvelopeOkResponse(CandleModel, { isArray: true, description: '캔들 배열 (오름차순)' })
  @ApiBadRequestResponse({ description: '지원하지 않는 symbol/interval 이거나 limit 이 범위를 벗어남' })
  findCandles(
    @Query(new ZodValidationPipe(candlesQuerySchema)) query: CandlesQuery,
  ): Promise<Candle[]> {
    return this.candlesService.findCandles(query);
  }
}

/**
 * Swagger 문서화 전용 모델 (시세·지표).
 *
 * 런타임 검증은 zod(`query.schemas.ts`)가 담당하고, 이 클래스들은 `/api/docs` 스키마 표시에만 쓴다.
 * 필드 구성은 `api-types.ts`(= frontend/src/types/api.ts) 와 반드시 일치해야 한다.
 */
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from '../../config/configuration';

export class CandleModel {
  @ApiProperty({ example: '2026-08-15T08:30:00.000Z', description: '봉 시작 시각 (UTC)' })
  openTime!: string;

  @ApiProperty({ example: '2026-08-15T08:30:59.999Z', description: '봉 종료 시각 (UTC)' })
  closeTime!: string;

  @ApiProperty({ example: 61234.5 })
  open!: number;

  @ApiProperty({ example: 61390.1 })
  high!: number;

  @ApiProperty({ example: 61180.0 })
  low!: number;

  @ApiProperty({ example: 61301.2 })
  close!: number;

  @ApiProperty({ example: 12.3456, description: '기초자산 거래량' })
  volume!: number;

  @ApiProperty({ example: 756123.45, description: '거래대금 (USDT)' })
  quoteVolume!: number;

  @ApiProperty({ example: 842 })
  tradeCount!: number;

  @ApiProperty({ example: 401233.1, description: 'taker 매수 체결대금' })
  takerBuyQuote!: number;
}

export class MetricsOverviewModel {
  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ example: '2026-08-15T08:31:02.113Z', description: '스냅샷 기준 시각' })
  asOf!: string;

  @ApiProperty({ example: 61301.2 })
  lastPrice!: number;

  @ApiProperty({ example: -1.42, description: '24시간 전 대비 변화율 (%)' })
  priceChangePct24h!: number;

  @ApiProperty({ example: 1893472113.5, description: '24시간 거래대금 (USDT)' })
  quoteVolume24h!: number;

  @ApiProperty({ example: 61280.7, description: '최근 N분 VWAP' })
  vwap!: number;

  @ApiProperty({ example: 0.03, description: '현재가와 VWAP의 이격도 (%)' })
  vwapDeviationPct!: number;

  @ApiProperty({ example: 38.2, description: '1분 수익률 기준 연율화 실현변동성 (%)' })
  realizedVolatility!: number;

  @ApiProperty({ example: 0.512, description: 'taker 매수 체결대금 비중 (0~1)' })
  takerBuyRatio!: number;

  @ApiProperty({ example: 842, description: '최근 1분 체결 건수' })
  tradeCount1m!: number;

  @ApiProperty({ example: 1.87, description: '직전 동일 구간 대비 거래대금 배수' })
  volumeSurgeRatio!: number;
}

export class MetricPointModel {
  @ApiProperty({ example: '2026-08-15T08:30:00.000Z' })
  ts!: string;

  @ApiProperty({ example: 61280.7 })
  value!: number;
}

export class MetricSeriesModel {
  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ example: 'vwap' })
  metric!: string;

  @ApiProperty({ example: '1h' })
  window!: string;

  @ApiProperty({ type: [MetricPointModel] })
  points!: MetricPointModel[];
}

export class CandleEventModel {
  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ enum: SUPPORTED_INTERVALS, example: '1m' })
  interval!: string;

  @ApiProperty({ type: CandleModel })
  candle!: CandleModel;

  @ApiProperty({ example: false, description: '봉 확정 여부' })
  isClosed!: boolean;
}

export class TickEventModel {
  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ example: 61301.2 })
  price!: number;

  @ApiProperty({ example: 0.0123 })
  qty!: number;

  @ApiProperty({ example: true, description: 'true면 시장가 매도(매수자가 maker)' })
  isBuyerMaker!: boolean;

  @ApiProperty({ example: '2026-08-15T08:31:02.113Z' })
  tradeTime!: string;
}

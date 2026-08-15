/**
 * Swagger 문서화 전용 모델 (운영·백필).
 * 필드 구성은 `api-types.ts`(= frontend/src/types/api.ts) 와 반드시 일치해야 한다.
 */
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from '../../config/configuration';

export class StreamHealthModel {
  @ApiProperty({ example: 'kline:BTCUSDT:1m' })
  streamKey!: string;

  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ enum: ['kline', 'trade'], example: 'kline' })
  kind!: string;

  @ApiProperty({ example: true })
  connected!: boolean;

  @ApiProperty({ example: '2026-08-15T08:31:02.113Z', nullable: true })
  lastEventAt!: string | null;

  @ApiProperty({ example: 0.4, nullable: true, description: '마지막 이벤트 이후 경과 초' })
  lagSeconds!: number | null;
}

export class CoverageRangeModel {
  @ApiProperty({ example: '2026-08-15T03:12:00.000Z' })
  from!: string;

  @ApiProperty({ example: '2026-08-15T03:15:00.000Z' })
  to!: string;
}

export class CoverageReportModel {
  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ enum: SUPPORTED_INTERVALS, example: '1m' })
  interval!: string;

  @ApiProperty({ example: 1440, description: '최근 24시간 기대 봉 수' })
  expected!: number;

  @ApiProperty({ example: 1437, description: '실제 저장된 봉 수' })
  actual!: number;

  @ApiProperty({ example: 0.9979, description: '커버리지 비율 (0~1). 1이면 무결점' })
  ratio!: number;

  @ApiProperty({ type: [CoverageRangeModel], description: '누락 구간 목록' })
  missingRanges!: CoverageRangeModel[];
}

export class BackfillSummaryModel {
  @ApiProperty({ example: 1 })
  running!: number;

  @ApiProperty({ example: 0 })
  pending!: number;

  @ApiProperty({ example: 0, description: '최근 24시간 실패 건수' })
  failed24h!: number;

  @ApiProperty({ example: '2026-08-15T08:12:44.001Z', nullable: true })
  lastSucceededAt!: string | null;
}

export class OpsHealthModel {
  @ApiProperty({ example: '2026-08-15T08:31:02.113Z' })
  serverTime!: string;

  @ApiProperty({ example: 3612, description: '프로세스 기동 후 경과 초' })
  uptimeSeconds!: number;

  @ApiProperty({ type: [StreamHealthModel] })
  streams!: StreamHealthModel[];

  @ApiProperty({ type: [CoverageReportModel], description: '최근 24시간 1분봉 커버리지' })
  coverage!: CoverageReportModel[];

  @ApiProperty({ type: BackfillSummaryModel })
  backfill!: BackfillSummaryModel;
}

export class BackfillJobModel {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ enum: SUPPORTED_INTERVALS, example: '1m' })
  interval!: string;

  @ApiProperty({ example: '2026-08-14T00:00:00.000Z' })
  rangeStart!: string;

  @ApiProperty({ example: '2026-08-15T00:00:00.000Z' })
  rangeEnd!: string;

  @ApiProperty({ enum: ['bootstrap', 'gap_recovery', 'manual'], example: 'manual' })
  reason!: string;

  @ApiProperty({ enum: ['pending', 'running', 'succeeded', 'failed'], example: 'pending' })
  status!: string;

  @ApiProperty({ example: 1440 })
  rowsWritten!: number;

  @ApiProperty({ example: 1 })
  attempts!: number;

  @ApiProperty({ example: null, nullable: true })
  error!: string | null;

  @ApiProperty({ example: '2026-08-15T08:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-15T08:30:01.000Z', nullable: true })
  startedAt!: string | null;

  @ApiProperty({ example: '2026-08-15T08:30:44.000Z', nullable: true })
  finishedAt!: string | null;
}

export class CollectorEventModel {
  @ApiProperty({ example: 981 })
  id!: number;

  @ApiProperty({ example: '2026-08-15T08:30:44.000Z' })
  ts!: string;

  @ApiProperty({ enum: ['info', 'warn', 'error'], example: 'warn' })
  level!: string;

  @ApiProperty({ example: 'gap_detected' })
  kind!: string;

  @ApiProperty({ example: 'kline:BTCUSDT:1m', nullable: true })
  stream!: string | null;

  @ApiProperty({ example: 'BTCUSDT 1m 3개 봉 누락 감지' })
  message!: string;

  @ApiProperty({ example: { missingCount: 3 }, nullable: true, type: 'object', additionalProperties: true })
  meta!: Record<string, unknown> | null;
}

export class ManualBackfillBodyModel {
  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'BTCUSDT' })
  symbol!: string;

  @ApiProperty({ enum: SUPPORTED_INTERVALS, example: '1m' })
  interval!: string;

  @ApiProperty({ example: '2026-08-14T00:00:00.000Z', description: 'ISO8601 UTC' })
  from!: string;

  @ApiProperty({ example: '2026-08-15T00:00:00.000Z', description: 'ISO8601 UTC' })
  to!: string;
}

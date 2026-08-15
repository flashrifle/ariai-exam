import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Optional,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { BACKFILL_PORT } from '../../common/ports';
import type { BackfillPort } from '../../common/ports';
import type { BackfillJob, CollectorEvent, OpsHealth } from '../dto/api-types';
import {
  BackfillJobModel,
  CollectorEventModel,
  ManualBackfillBodyModel,
  OpsHealthModel,
} from '../dto/swagger.ops.models';
import { ApiEnvelopeOkResponse } from '../dto/swagger.helpers';
import {
  BACKFILL_JOB_LIMIT_DEFAULT,
  BACKFILL_JOB_LIMIT_MAX,
  COLLECTOR_EVENT_LIMIT_DEFAULT,
  COLLECTOR_EVENT_LIMIT_MAX,
  backfillJobsQuerySchema,
  collectorEventsQuerySchema,
  manualBackfillBodySchema,
} from '../dto/query.schemas';
import type {
  BackfillJobsQuery,
  CollectorEventsQuery,
  ManualBackfillBody,
} from '../dto/query.schemas';
import { OpsHealthService } from './ops-health.service';
import { OpsQueryService } from './ops-query.service';

/** 실제 경로: `/api/v1/ops/*` (전역 prefix 는 main.ts). */
@ApiTags('ops')
@Controller('ops')
export class OpsController {
  private readonly logger = new Logger(OpsController.name);

  constructor(
    private readonly health: OpsHealthService,
    private readonly opsQuery: OpsQueryService,
    @Optional() @Inject(BACKFILL_PORT) private readonly backfill: BackfillPort | null = null,
  ) {}

  @Get('health')
  @ApiOperation({
    summary: '수집 건강도',
    description:
      '스트림별 연결 상태·지연(lagSeconds), 최근 24시간 1분봉 커버리지(기대 1440봉 대비 실제/누락 구간), 백필 job 요약을 한 번에 반환한다.',
  })
  @ApiEnvelopeOkResponse(OpsHealthModel, { description: '수집 파이프라인 건강도 스냅샷' })
  getHealth(): Promise<OpsHealth> {
    return this.health.getHealth();
  }

  @Get('backfill-jobs')
  @ApiOperation({ summary: '백필 이력 (최신순)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: BACKFILL_JOB_LIMIT_MAX,
      default: BACKFILL_JOB_LIMIT_DEFAULT,
    },
  })
  @ApiEnvelopeOkResponse(BackfillJobModel, { isArray: true })
  @ApiBadRequestResponse({ description: 'limit 이 범위를 벗어남' })
  listBackfillJobs(
    @Query(new ZodValidationPipe(backfillJobsQuerySchema)) query: BackfillJobsQuery,
  ): Promise<BackfillJob[]> {
    return this.opsQuery.listBackfillJobs(query.limit);
  }

  @Get('events')
  @ApiOperation({ summary: '수집기 운영 로그 (최신순)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: COLLECTOR_EVENT_LIMIT_MAX,
      default: COLLECTOR_EVENT_LIMIT_DEFAULT,
    },
  })
  @ApiEnvelopeOkResponse(CollectorEventModel, { isArray: true })
  @ApiBadRequestResponse({ description: 'limit 이 범위를 벗어남' })
  listEvents(
    @Query(new ZodValidationPipe(collectorEventsQuerySchema)) query: CollectorEventsQuery,
  ): Promise<CollectorEvent[]> {
    return this.opsQuery.listCollectorEvents(query.limit);
  }

  @Post('backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '수동 백필 트리거',
    description: '구간을 지정해 백필 job 을 큐에 넣는다. 응답은 생성된 job 이며 즉시 완료되지 않는다.',
  })
  @ApiBody({ type: ManualBackfillBodyModel })
  @ApiEnvelopeOkResponse(BackfillJobModel, { description: '생성된 백필 job' })
  @ApiBadRequestResponse({ description: '구간이 뒤집혔거나 31일을 초과, 또는 미래 시각' })
  @ApiServiceUnavailableResponse({ description: '백필 모듈이 아직 준비되지 않음' })
  async triggerBackfill(
    @Body(new ZodValidationPipe(manualBackfillBodySchema)) body: ManualBackfillBody,
  ): Promise<BackfillJob> {
    if (this.backfill === null) {
      throw new ServiceUnavailableException('백필 서비스가 아직 준비되지 않았습니다');
    }

    const { jobId } = await this.backfill.enqueueManual(body);
    const persisted = await this.opsQuery.findBackfillJob(jobId);
    if (persisted !== null) {
      return persisted;
    }

    // job 은 수락됐지만 아직 행이 보이지 않는 경우(트랜잭션 타이밍) — 요청 내용으로 pending 응답을 만든다.
    this.logger.warn(`백필 job(${jobId}) 행을 아직 읽을 수 없어 pending 스냅샷으로 응답합니다`);
    return buildPendingJob(jobId, body);
  }
}

function buildPendingJob(id: number, body: ManualBackfillBody): BackfillJob {
  return {
    id,
    symbol: body.symbol,
    interval: body.interval,
    rangeStart: body.from.toISOString(),
    rangeEnd: body.to.toISOString(),
    reason: 'manual',
    status: 'pending',
    rowsWritten: 0,
    attempts: 0,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
}

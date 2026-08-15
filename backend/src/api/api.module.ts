import { Module } from '@nestjs/common';
import { CandlesController } from './candles/candles.controller';
import { CandlesService } from './candles/candles.service';
import { MetricsController } from './metrics/metrics.controller';
import { OpsController } from './ops/ops.controller';
import { OpsHealthService } from './ops/ops-health.service';
import { OpsQueryService } from './ops/ops-query.service';

/**
 * HTTP API 모듈.
 *
 * 전제 (app.module.ts 에서 준비되어야 함):
 *  - `DRIZZLE` 토큰을 제공하는 DB 모듈이 global 이거나 여기에 import 되어 있을 것
 *  - `ConfigService` 사용 가능 (`ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`)
 *  - 선택: `METRICS_PORT`, `BACKFILL_PORT`, `INGEST_PORT` 바인딩
 *    (없으면 지표/백필은 503, health 는 DB 기반 대체 경로로 동작한다)
 *
 * `OpsHealthService` 는 SSE(`ops` 이벤트)에서도 쓰이므로 export 한다.
 */
@Module({
  controllers: [CandlesController, MetricsController, OpsController],
  providers: [CandlesService, OpsHealthService, OpsQueryService],
  exports: [OpsHealthService],
})
export class ApiModule {}

/**
 * 포트 바인딩 모듈 (팀 리더 관리).
 *
 * API/SSE 레이어는 `MetricsService` 같은 구현 클래스를 직접 import 하지 않고
 * `METRICS_PORT` / `BACKFILL_PORT` / `INGEST_PORT` 토큰으로만 주입받는다.
 * 그 토큰을 실제 구현에 연결하는 유일한 지점이 여기다.
 *
 * @Global 인 이유: 토큰을 필요로 하는 모듈(ApiModule, RealtimeModule)이
 * 구현 모듈을 import 하게 되면 포트로 끊어낸 의존 방향이 도로 붙기 때문이다.
 */
import { Global, Module } from '@nestjs/common';
import { BACKFILL_PORT, INGEST_PORT, METRICS_PORT } from './common/ports';
import { BackfillModule } from './backfill/backfill.module';
import { BackfillService } from './backfill/backfill.service';
import { IngestModule } from './ingest/ingest.module';
import { IngestService } from './ingest/ingest.service';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsService } from './metrics/metrics.service';

@Global()
@Module({
  imports: [MetricsModule, BackfillModule, IngestModule],
  providers: [
    { provide: METRICS_PORT, useExisting: MetricsService },
    { provide: BACKFILL_PORT, useExisting: BackfillService },
    { provide: INGEST_PORT, useExisting: IngestService },
  ],
  exports: [METRICS_PORT, BACKFILL_PORT, INGEST_PORT],
})
export class PortsModule {}

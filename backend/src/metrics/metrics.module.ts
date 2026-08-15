/**
 * 지표 모듈.
 *
 * app.module.ts 는 팀 리더 소유이므로 여기서 등록만 요청한다.
 * 이 모듈이 전제하는 전역 의존성 (루트 모듈에서 보장 필요):
 *   - ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })
 *   - EventEmitterModule.forRoot()  (metrics.updated 발행 / kline.closed 구독)
 *   - DRIZZLE 토큰을 제공·export 하는 전역 DB 모듈
 */
import { Module } from '@nestjs/common';
import { MetricsCacheService } from './metrics-cache.service';
import { MetricsService } from './metrics.service';

@Module({
  providers: [MetricsCacheService, MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}

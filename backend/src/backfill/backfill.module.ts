/**
 * 백필 · 갭 복구 모듈.
 *
 * 전제 (팀 리더의 app.module wiring):
 * - ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })
 * - EventEmitterModule.forRoot()
 * - ScheduleModule.forRoot()  ← SchedulerRegistry 주입에 필요 (global 모듈)
 *
 * 다른 담당자 소유 모듈 의존:
 * - DbModule: KlineRepository / BackfillJobRepository 를 export
 * - BinanceModule: BinanceRestClient(weight 레이트리미터 내장)를 export
 */
import { Module } from '@nestjs/common';
import { BinanceModule } from '../binance/binance.module';
import { DbModule } from '../db/db.module';
import { BackfillRunner } from './backfill-runner';
import { BackfillService } from './backfill.service';
import { GapDetector } from './gap-detector';

@Module({
  imports: [DbModule, BinanceModule],
  providers: [GapDetector, BackfillRunner, BackfillService],
  // 운영 API 담당자가 수동 트리거(POST /ops/backfill)에 사용한다.
  exports: [BackfillService],
})
export class BackfillModule {}

/**
 * 실시간 수집 모듈.
 *
 * IngestService.getStreamHealth()는 운영 API(/ops/health) 담당자가 사용하므로 export 한다.
 *
 * [팀 리더 배선 요청]
 * - DRIZZLE 토큰, KlineRepository, TradeRepository 는 DB 모듈이 제공한다.
 *   DB 모듈이 전역(@Global)이 아니라면 app.module 배선 시 이 모듈에서 접근 가능하게 해줄 것.
 * - EventEmitterModule.forRoot() 가 루트에 등록되어 있어야 한다.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BinanceModule } from '../binance/binance.module';
import { DRIZZLE, type Database } from '../db/db.tokens';
import { IngestStateStore } from './ingest-state.store';
import { IngestService } from './ingest.service';
import { OpsEventRecorder } from './ops-event.recorder';

@Module({
  imports: [ConfigModule, BinanceModule],
  providers: [
    {
      provide: IngestStateStore,
      useFactory: (db: Database) => new IngestStateStore(db),
      inject: [DRIZZLE],
    },
    {
      provide: OpsEventRecorder,
      useFactory: (db: Database) => new OpsEventRecorder(db),
      inject: [DRIZZLE],
    },
    IngestService,
  ],
  exports: [IngestService],
})
export class IngestModule {}

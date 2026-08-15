/**
 * 루트 모듈 (팀 리더 관리).
 *
 * 각 담당 모듈이 전제하는 전역 의존성을 여기서 한 번에 보장한다:
 *  - ConfigModule.forRoot({ isGlobal, validate })  — 부팅 시 환경변수 검증
 *  - EventEmitterModule.forRoot()                  — 모듈 간 이벤트 버스
 *  - ScheduleModule.forRoot()                      — 갭 스캔 주기 실행
 *  - DbModule (@Global)                            — DRIZZLE 토큰과 리포지토리
 *  - PortsModule (@Global)                         — API/SSE ↔ 구현 서비스 연결
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiModule } from './api/api.module';
import { BackfillModule } from './backfill/backfill.module';
import { BinanceModule } from './binance/binance.module';
import { validateEnv } from './config/configuration';
import { DbModule } from './db/db.module';
import { IngestModule } from './ingest/ingest.module';
import { MetricsModule } from './metrics/metrics.module';
import { PortsModule } from './ports.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 잘못된 설정으로 서버가 반쯤 살아 있는 상태를 막기 위해 부팅 시점에 검증한다.
      validate: validateEnv,
      envFilePath: ['.env'],
      cache: true,
    }),
    EventEmitterModule.forRoot({
      // 수집기는 스트림별로 리스너가 붙으므로 기본 상한(10)을 넘길 수 있다.
      maxListeners: 50,
      verboseMemoryLeak: true,
    }),
    ScheduleModule.forRoot(),

    DbModule,
    BinanceModule,
    IngestModule,
    BackfillModule,
    MetricsModule,
    PortsModule,

    ApiModule,
    RealtimeModule,
  ],
})
export class AppModule {}

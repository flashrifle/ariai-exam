/**
 * 거래소 연동 모듈.
 *
 * BinanceRateLimiter / BinanceRestClient 는 백필 모듈도 재사용하므로 반드시 export 한다.
 * 리미터는 프로세스 전역에서 단일 인스턴스여야 IP 기준 weight 예산이 정확히 지켜진다.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/configuration';
import { BinanceRestClient } from './binance-rest.client';
import { BinanceWsClient } from './binance-ws.client';
import { BinanceRateLimiter } from './rate-limiter';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: BinanceRateLimiter,
      useFactory: (config: ConfigService<AppEnv, true>) =>
        new BinanceRateLimiter({
          budgetPerMin: config.get('REST_WEIGHT_BUDGET_PER_MIN', { infer: true }),
        }),
      inject: [ConfigService],
    },
    {
      provide: BinanceRestClient,
      useFactory: (config: ConfigService<AppEnv, true>, limiter: BinanceRateLimiter) =>
        new BinanceRestClient(
          { baseUrl: config.get('BINANCE_REST_BASE_URL', { infer: true }) },
          limiter,
        ),
      inject: [ConfigService, BinanceRateLimiter],
    },
    {
      provide: BinanceWsClient,
      useFactory: (config: ConfigService<AppEnv, true>) =>
        new BinanceWsClient({ baseUrl: config.get('BINANCE_WS_BASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
  ],
  exports: [BinanceRateLimiter, BinanceRestClient, BinanceWsClient],
})
export class BinanceModule {}

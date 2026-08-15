/**
 * 체결(trade) 원본 보존정책 집행.
 *
 * trades 는 초당 수 건씩 무한히 쌓이는 유일한 테이블이다(1분봉은 하루 2,880행에 불과).
 * TRADE_RETENTION_DAYS 설정만 있고 실제로 지우는 주체가 없으면 디스크가 계속 증가하므로,
 * 이 서비스가 주기적으로 보존 기간이 지난 행을 정리한다.
 *
 * 지표는 확정된 1분봉(klines)에서 계산하므로, 오래된 체결 원본을 지워도
 * 과거 구간의 지표·차트는 영향을 받지 않는다.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AppEnv } from '../config/configuration';
import { TradeRepository } from '../db/repositories/trade.repository';

const MS_PER_DAY = 86_400_000;

@Injectable()
export class TradeRetentionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TradeRetentionService.name);
  private readonly retentionDays: number;
  /** 정리 작업이 겹쳐 도는 것을 막는다 (대량 삭제는 오래 걸릴 수 있다). */
  private isPurging = false;

  constructor(
    private readonly tradeRepository: TradeRepository,
    config: ConfigService<AppEnv, true>,
  ) {
    this.retentionDays = config.get('TRADE_RETENTION_DAYS', { infer: true });
  }

  /**
   * 기동 시 1회 정리한다.
   * 서버가 오래 꺼져 있었다면 이미 보존 기간을 넘긴 데이터가 남아 있기 때문이다.
   */
  onApplicationBootstrap(): void {
    void this.purge('startup');
  }

  /** 거래량이 적은 시간대에 돌려 운영 중 부하를 피한다. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeScheduled(): Promise<void> {
    await this.purge('scheduled');
  }

  private async purge(trigger: 'startup' | 'scheduled'): Promise<void> {
    if (this.isPurging) {
      this.logger.warn('이전 보존정책 정리가 아직 진행 중이라 이번 실행을 건너뜁니다');
      return;
    }
    this.isPurging = true;

    const cutoff = new Date(Date.now() - this.retentionDays * MS_PER_DAY);
    try {
      const deleted = await this.tradeRepository.deleteOlderThan(cutoff);
      if (deleted > 0) {
        this.logger.log(
          `체결 보존정책 정리 완료 (${trigger}): ${cutoff.toISOString()} 이전 ${deleted}행 삭제 ` +
            `(보존 ${this.retentionDays}일)`,
        );
      } else {
        this.logger.log(`체결 보존정책 정리 완료 (${trigger}): 삭제 대상 없음`);
      }
    } catch (error: unknown) {
      // 정리 실패가 수집을 멈추게 해서는 안 되므로 로깅만 하고 다음 주기를 기다린다.
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`체결 보존정책 정리 실패 (${trigger}): ${detail}`);
    } finally {
      this.isPurging = false;
    }
  }
}

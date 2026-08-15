/**
 * 지표 스냅샷 캐시.
 *
 * - METRICS_REFRESH_MS 주기로 심볼별 MetricsOverview 를 재계산해 메모리에 보관한다.
 *   조회(getOverview)는 캐시에서 즉시 반환하므로 요청마다 무거운 집계가 돌지 않는다.
 * - 갱신할 때마다 `metrics.updated` 이벤트를 발행한다 — realtime(SSE) 담당이 구독해
 *   SSE `metrics` 이벤트로 프론트에 밀어낸다.
 * - `kline.closed`(1분봉 확정)를 구독해 스냅샷을 앞당겨 갱신한다 (CONTRACT 4.2절).
 * - 첫 계산이 끝나기 전 요청은 진행 중 계산(또는 즉석 계산)을 기다렸다가 반환한다.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AppEvents, type KlinePayload } from '../common/events';
import type { SupportedSymbol } from '../config/configuration';
import { DRIZZLE, type Database } from '../db/db.tokens';
import { resolveMetricsConfig, type MetricsRuntimeConfig } from './metrics.config';
import { MetricsEvents, type MetricsUpdatedPayload } from './metrics.constants';
import type { MetricsOverview } from './metrics.types';
import { buildOverviewQuery, mapOverviewRow, type OverviewRow } from './overview.query';

@Injectable()
export class MetricsCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsCacheService.name);
  private readonly snapshots = new Map<SupportedSymbol, MetricsOverview>();
  private readonly inflight = new Map<SupportedSymbol, Promise<MetricsOverview>>();
  private readonly config: MetricsRuntimeConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRefreshing = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly emitter: EventEmitter2,
    configService: ConfigService,
  ) {
    this.config = resolveMetricsConfig(configService);
  }

  onModuleInit(): void {
    // 부팅 직후 첫 스냅샷을 만들어 두고, 이후 주기적으로 갱신한다.
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), this.config.refreshMs);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * 캐시된 스냅샷 반환.
   * 첫 계산이 끝나기 전에 요청이 오면 진행 중 계산을 기다렸다가 반환한다.
   */
  async getOverview(symbol: SupportedSymbol): Promise<MetricsOverview> {
    const cached = this.snapshots.get(symbol);
    if (cached) return cached;
    return this.computeOnce(symbol);
  }

  /** 1분봉 확정 즉시 해당 심볼 스냅샷을 앞당겨 갱신·발행한다. */
  @OnEvent(AppEvents.KLINE_CLOSED)
  handleKlineClosed(payload: KlinePayload): void {
    if (!this.config.symbols.includes(payload.symbol)) return;
    void this.computeOnce(payload.symbol)
      .then((overview) => this.publish(overview))
      .catch((error: unknown) =>
        this.logError('kline.closed 트리거 스냅샷 갱신 실패', payload.symbol, error),
      );
  }

  /** 동일 심볼의 중복 동시 계산을 막는다. 항상 DB 에서 새로 계산한다. */
  private computeOnce(symbol: SupportedSymbol): Promise<MetricsOverview> {
    const pending = this.inflight.get(symbol);
    if (pending) return pending;
    const task = this.computeFromDb(symbol).finally(() => this.inflight.delete(symbol));
    this.inflight.set(symbol, task);
    return task;
  }

  private async computeFromDb(symbol: SupportedSymbol): Promise<MetricsOverview> {
    const result = await this.db.execute(
      buildOverviewQuery(symbol, this.config.windowMinutes),
    );
    const row = result.rows[0] as unknown as OverviewRow | undefined;
    if (!row) {
      throw new Error(`지표 스냅샷 질의가 빈 결과를 반환했습니다: ${symbol}`);
    }
    const overview = mapOverviewRow(symbol, row);
    this.snapshots.set(symbol, overview);
    return overview;
  }

  private async refreshAll(): Promise<void> {
    if (this.isRefreshing) return; // 갱신이 주기보다 오래 걸리면 다음 틱을 건너뛴다.
    this.isRefreshing = true;
    try {
      for (const symbol of this.config.symbols) {
        try {
          this.publish(await this.computeOnce(symbol));
        } catch (error: unknown) {
          // 실패해도 마지막 정상 스냅샷은 유지한다. 오류는 삼키지 않고 기록한다.
          this.logError('지표 스냅샷 주기 갱신 실패', symbol, error);
        }
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  private publish(overview: MetricsOverview): void {
    const payload: MetricsUpdatedPayload = { overview };
    this.emitter.emit(MetricsEvents.METRICS_UPDATED, payload);
  }

  private logError(context: string, symbol: string, error: unknown): void {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.logger.error(`${context} (${symbol}): ${detail}`);
  }
}

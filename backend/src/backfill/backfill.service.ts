/**
 * 백필 오케스트레이터 — 세 진입점(bootstrap / recoverGaps / runManual)이
 * 하나의 공통 엔진(runWindow: 갭 탐지 → job 생성 → 동시성 제한 실행)으로 수렴한다.
 *
 * 기동 시퀀스: DB가 비어 있으면 bootstrap, 데이터가 있으면 마지막 저장 지점부터
 * 현재까지를 다운타임 갭으로 보고 gap_recovery 로 처리한다 (startup-plan.ts 참조).
 */
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppEvents, type GapDetectedPayload } from '../common/events';
import {
  BASE_INTERVAL,
  BASE_INTERVAL_MS,
  type AppEnv,
  type SupportedSymbol,
} from '../config/configuration';
import { BackfillJobRepository } from '../db/repositories/backfill-job.repository';
import { KlineRepository } from '../db/repositories/kline.repository';
import { toErrorMessage } from './async-util';
import {
  DAY_MS,
  GAP_SCAN_GRACE_CANDLES,
  GAP_SCAN_INTERVAL_NAME,
  HOUR_MS,
  JOB_CONCURRENCY,
  MANUAL_MAX_RANGE_DAYS,
} from './backfill.constants';
import { BackfillValidationError } from './backfill.errors';
import type {
  BackfillJobSpec,
  BackfillReason,
  BackfillRunSummary,
  ManualBackfillRequest,
  TimeRange,
} from './backfill.types';
import { BackfillRunner } from './backfill-runner';
import { GapDetector } from './gap-detector';
import { ceilToStep, countCandles, floorToStep, rangesOverlap } from './gap-math';
import { emitBackfillProgress } from './progress-emitter';
import { runWithConcurrency } from './async-util';
import { resolveStartupPlan } from './startup-plan';

@Injectable()
export class BackfillService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackfillService.name);

  private readonly symbols: readonly SupportedSymbol[];
  private readonly bootstrapDays: number;
  private readonly gapScanIntervalSec: number;
  private readonly gapScanLookbackHours: number;

  /** 주기 스캔/부트스트랩 중복 진입 방지 플래그. */
  private isEngineBusy = false;
  /** 진행 중 구간 추적 — 같은 구간에 job 이 중복 생성되는 것을 막는다. */
  private inFlightRanges = new Map<SupportedSymbol, readonly TimeRange[]>();

  constructor(
    config: ConfigService<AppEnv, true>,
    private readonly gapDetector: GapDetector,
    private readonly runner: BackfillRunner,
    private readonly jobRepository: BackfillJobRepository,
    private readonly klineRepository: KlineRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.symbols = config.get('SYMBOLS', { infer: true });
    this.bootstrapDays = config.get('BOOTSTRAP_BACKFILL_DAYS', { infer: true });
    this.gapScanIntervalSec = config.get('GAP_SCAN_INTERVAL_SEC', { infer: true });
    this.gapScanLookbackHours = config.get('GAP_SCAN_LOOKBACK_HOURS', { infer: true });
  }

  /** 앱 부팅을 블로킹하지 않도록 기동 시퀀스는 비동기로 시작한다. */
  onApplicationBootstrap(): void {
    void this.runStartupSequence();
    this.registerGapScanInterval();
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', GAP_SCAN_INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(GAP_SCAN_INTERVAL_NAME);
    }
  }

  /**
   * 앱 기동 시 1회. 심볼별로 데이터 유무를 판단해
   * 비어 있으면 BOOTSTRAP_BACKFILL_DAYS 만큼(reason='bootstrap'),
   * 있으면 마지막 저장 지점 이후를 다운타임 갭으로(reason='gap_recovery') 채운다.
   */
  async bootstrap(): Promise<void> {
    if (this.isEngineBusy) {
      this.logger.warn('백필 엔진이 이미 동작 중이라 bootstrap 을 건너뜁니다');
      return;
    }
    this.isEngineBusy = true;
    try {
      for (const symbol of this.symbols) {
        await this.bootstrapSymbol(symbol);
      }
    } finally {
      this.isEngineBusy = false;
    }
  }

  /**
   * 주기 갭 스캔: GAP_SCAN_LOOKBACK_HOURS 범위를 훑어 누락 구간을 복구한다.
   * 이전 스캔이 끝나지 않았으면 이번 주기는 건너뛴다 (중복 실행 방지).
   */
  async recoverGaps(): Promise<void> {
    if (this.isEngineBusy) {
      this.logger.debug('이전 갭 스캔이 진행 중이라 이번 주기를 건너뜁니다');
      return;
    }
    this.isEngineBusy = true;
    try {
      // 방금 닫힌 봉은 WS 반영 유예를 위해 제외한다 — 실제 누락이면 다음 주기에 잡힌다.
      const endMs =
        floorToStep(Date.now(), BASE_INTERVAL_MS) - GAP_SCAN_GRACE_CANDLES * BASE_INTERVAL_MS;
      const startMs = endMs - this.gapScanLookbackHours * HOUR_MS;
      for (const symbol of this.symbols) {
        try {
          await this.runWindow(symbol, startMs, endMs, 'gap_recovery');
        } catch (error) {
          this.logger.error(`갭 복구 실패(${symbol}): ${toErrorMessage(error)}`);
        }
      }
    } finally {
      this.isEngineBusy = false;
    }
  }

  /** 운영 API 수동 트리거 (POST /ops/backfill). 검증 실패 시 BackfillValidationError. */
  async runManual(request: ManualBackfillRequest): Promise<BackfillRunSummary> {
    this.validateManualRequest(request);
    // 요청 구간을 봉 경계로 정규화: from 내림, to 올림 (요청이 걸친 봉까지 포함).
    const startMs = floorToStep(request.from.getTime(), BASE_INTERVAL_MS);
    const endMs = ceilToStep(request.to.getTime(), BASE_INTERVAL_MS);
    return this.runWindow(request.symbol, startMs, endMs, 'manual');
  }

  /** 기동 시퀀스: bootstrap/다운타임 복구 → 즉시 1회 갭 스캔. */
  private async runStartupSequence(): Promise<void> {
    try {
      await this.bootstrap();
    } catch (error) {
      this.logger.error(`기동 백필 실패: ${toErrorMessage(error)}`);
    }
    await this.recoverGaps();
  }

  /** 심볼 하나의 기동 판단 + 실행. */
  private async bootstrapSymbol(symbol: SupportedSymbol): Promise<void> {
    try {
      const latest = await this.klineRepository.latestOpenTime(symbol, BASE_INTERVAL);
      const plan = resolveStartupPlan(
        latest === null ? null : latest.getTime(),
        Date.now(),
        BASE_INTERVAL_MS,
        this.bootstrapDays,
      );
      if (plan === null) {
        this.logger.log(`${symbol} 은(는) 이미 최신 상태 — 기동 백필 불필요`);
        return;
      }
      this.logger.log(
        `${symbol} 기동 백필 시작 (reason=${plan.reason}, ` +
          `${new Date(plan.windowStartMs).toISOString()} ~ ${new Date(plan.windowEndMs).toISOString()})`,
      );
      await this.runWindow(symbol, plan.windowStartMs, plan.windowEndMs, plan.reason);
    } catch (error) {
      this.logger.error(`${symbol} 기동 백필 실패: ${toErrorMessage(error)}`);
    }
  }

  /** 공통 실행 엔진: 갭 탐지 → 진행 중 구간 제외 → job 생성 → 동시성 제한 실행. */
  private async runWindow(
    symbol: SupportedSymbol,
    windowStartMs: number,
    windowEndMs: number,
    reason: BackfillReason,
  ): Promise<BackfillRunSummary> {
    const gaps = await this.gapDetector.detectGaps(
      symbol,
      BASE_INTERVAL,
      new Date(windowStartMs),
      new Date(windowEndMs),
    );
    const { runnable, skipped } = this.splitByInFlight(symbol, gaps);
    if (skipped.length > 0) {
      this.logger.debug(`${symbol}: 이미 진행 중인 구간 ${skipped.length}개 건너뜀`);
    }
    // detectGaps 의 await 이후 동기적으로 예약해 동시 호출 간 경합을 막는다.
    this.trackRanges(symbol, runnable);
    try {
      const jobs = await this.createJobs(symbol, runnable, reason);
      const results = await runWithConcurrency(jobs, JOB_CONCURRENCY, (job) =>
        this.runner.runJob(job),
      );
      return {
        symbol,
        interval: BASE_INTERVAL,
        reason,
        detectedGapCount: gaps.length,
        skippedInFlightCount: skipped.length,
        jobs: results,
      };
    } finally {
      this.untrackRanges(symbol, runnable);
    }
  }

  /** 갭 구간마다 GAP_DETECTED 발행 + backfill_jobs 행(pending) 생성. */
  private async createJobs(
    symbol: SupportedSymbol,
    ranges: readonly TimeRange[],
    reason: BackfillReason,
  ): Promise<BackfillJobSpec[]> {
    const jobs: BackfillJobSpec[] = [];
    for (const range of ranges) {
      const gapPayload: GapDetectedPayload = {
        symbol,
        interval: BASE_INTERVAL,
        from: new Date(range.startMs),
        to: new Date(range.endMs),
        missingCount: countCandles(range, BASE_INTERVAL_MS),
      };
      this.eventEmitter.emit(AppEvents.GAP_DETECTED, gapPayload);
      const created = await this.jobRepository.create({
        symbol,
        interval: BASE_INTERVAL,
        rangeStart: new Date(range.startMs),
        rangeEnd: new Date(range.endMs),
        reason,
      });
      const job: BackfillJobSpec = { jobId: created.id, symbol, interval: BASE_INTERVAL, range };
      emitBackfillProgress(this.eventEmitter, job, 'pending', 0);
      jobs.push(job);
    }
    return jobs;
  }

  /** 진행 중 구간과 겹치는 갭은 실행 대상에서 제외한다 (다음 스캔이 잔여분을 잡는다). */
  private splitByInFlight(
    symbol: SupportedSymbol,
    gaps: readonly TimeRange[],
  ): { runnable: TimeRange[]; skipped: TimeRange[] } {
    const active = this.inFlightRanges.get(symbol) ?? [];
    const runnable: TimeRange[] = [];
    const skipped: TimeRange[] = [];
    for (const gap of gaps) {
      const isOverlapping = active.some((range) => rangesOverlap(range, gap));
      (isOverlapping ? skipped : runnable).push(gap);
    }
    return { runnable, skipped };
  }

  private trackRanges(symbol: SupportedSymbol, ranges: readonly TimeRange[]): void {
    const current = this.inFlightRanges.get(symbol) ?? [];
    this.inFlightRanges.set(symbol, [...current, ...ranges]);
  }

  private untrackRanges(symbol: SupportedSymbol, ranges: readonly TimeRange[]): void {
    const current = this.inFlightRanges.get(symbol) ?? [];
    this.inFlightRanges.set(
      symbol,
      current.filter((range) => !ranges.includes(range)),
    );
  }

  /** 수동 요청 검증 — 시스템 경계 입력은 신뢰하지 않는다. */
  private validateManualRequest(request: ManualBackfillRequest): void {
    if (!this.symbols.includes(request.symbol)) {
      throw new BackfillValidationError(`지원하지 않는 심볼입니다: ${String(request.symbol)}`);
    }
    if (request.interval !== BASE_INTERVAL) {
      throw new BackfillValidationError(
        `백필은 저장 기준 인터벌(${BASE_INTERVAL})만 지원합니다: ${String(request.interval)}`,
      );
    }
    const fromMs = request.from instanceof Date ? request.from.getTime() : Number.NaN;
    const toMs = request.to instanceof Date ? request.to.getTime() : Number.NaN;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      throw new BackfillValidationError('from/to 는 유효한 UTC 시각이어야 합니다');
    }
    if (fromMs >= toMs) {
      throw new BackfillValidationError('from 은 to 보다 이전이어야 합니다');
    }
    if (toMs - fromMs > MANUAL_MAX_RANGE_DAYS * DAY_MS) {
      throw new BackfillValidationError(
        `수동 백필 구간은 최대 ${MANUAL_MAX_RANGE_DAYS}일까지 허용됩니다`,
      );
    }
  }

  /** 주기 갭 스캔 등록 — 주기가 환경변수이므로 @Interval 대신 SchedulerRegistry 를 쓴다. */
  private registerGapScanInterval(): void {
    const handle = setInterval(() => {
      this.recoverGaps().catch((error: unknown) => {
        this.logger.error(`주기 갭 스캔 오류: ${toErrorMessage(error)}`);
      });
    }, this.gapScanIntervalSec * 1000);
    this.schedulerRegistry.addInterval(GAP_SCAN_INTERVAL_NAME, handle);
    this.logger.log(`갭 스캔 주기 등록: ${this.gapScanIntervalSec}초`);
  }
}

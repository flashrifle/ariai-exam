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
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  AppEvents,
  type GapDetectedPayload,
  type StreamStatusPayload,
} from '../common/events';
import type { BackfillPort, ManualBackfillResult } from '../common/ports';
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
import { parseSymbolFromKlineStreamKey, readIsoDate } from './stream-status.util';

@Injectable()
// BackfillPort 를 명시적으로 구현한다 — 포트와 구현이 어긋나면 런타임이 아니라 컴파일에서 잡힌다.
export class BackfillService implements OnApplicationBootstrap, OnModuleDestroy, BackfillPort {
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

  /**
   * 포트 계약(BackfillPort) 구현 — 운영 API의 수동 트리거 진입점.
   *
   * runManual()은 갭 탐지 결과에 따라 job 을 0개 이상 만들지만,
   * API 는 "이 요청이 어떻게 처리됐는가"를 가리키는 job 하나를 필요로 한다.
   * 채울 갭이 없어 job 이 생기지 않았다면 그 사실 자체를 0행 job 으로 남긴다 —
   * 운영자가 요청을 보냈는데 이력에 아무것도 없는 상황을 만들지 않기 위해서다.
   */
  async enqueueManual(request: ManualBackfillRequest): Promise<ManualBackfillResult> {
    const summary = await this.runManual(request);
    const firstJob = summary.jobs.at(0);
    if (firstJob !== undefined) {
      return { jobId: firstJob.jobId };
    }

    const job = await this.jobRepository.create({
      symbol: request.symbol,
      interval: request.interval,
      rangeStart: request.from,
      rangeEnd: request.to,
      reason: 'manual',
    });
    await this.jobRepository.markRunning(job.id);
    await this.jobRepository.markSucceeded(job.id, 0);
    this.logger.log(
      `수동 백필: 요청 구간에 채울 갭이 없어 job ${job.id}을(를) 0행으로 기록했습니다 ` +
        `(${request.symbol}, ${request.from.toISOString()} ~ ${request.to.toISOString()})`,
    );
    return { jobId: job.id };
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

  /**
   * 공통 실행 엔진: 갭 탐지 → 진행 중 구간 제외 → job 생성 → 동시성 제한 실행.
   *
   * `force`가 켜지면 갭 탐지를 건너뛰고 구간 전체를 다시 받는다.
   * 갭 탐지는 open_time 의 **존재 여부**만 보므로, 행이 있지만 내용이 불완전한 경우
   * (WS 미확정 봉이 저장된 직후 연결이 끊겨 최종본을 못 받은 경우)를 찾아내지 못한다.
   * 그런 구간은 존재 여부와 무관하게 REST 원본으로 덮어써야 복구된다.
   */
  private async runWindow(
    symbol: SupportedSymbol,
    windowStartMs: number,
    windowEndMs: number,
    reason: BackfillReason,
    options: { readonly force?: boolean } = {},
  ): Promise<BackfillRunSummary> {
    const gaps =
      options.force === true
        ? windowStartMs < windowEndMs
          ? [{ startMs: windowStartMs, endMs: windowEndMs }]
          : []
        : await this.gapDetector.detectGaps(
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

  /**
   * WS 재연결 시 다운타임 구간을 강제로 다시 받는다.
   *
   * 왜 갭 스캔만으로 부족한가:
   * ingest 는 미확정 봉도 upsert 해 실시간 차트를 움직인다. 그 직후 연결이 끊기면
   * 해당 분봉은 "부분 스냅샷 상태로 존재"하게 되는데, Binance kline 스트림은 재연결 후
   * 진행 중인 봉만 보내므로 그 봉의 최종본은 영영 오지 않는다.
   * 갭 탐지는 행의 존재 여부만 보기 때문에 이 봉을 갭으로 잡지 못하고,
   * 결과적으로 커버리지는 100% 로 보이는데 값은 오염된 상태가 영구히 남는다.
   *
   * 그래서 끊김 직전 봉부터 복구 시점까지를 force 모드로 다시 받는다.
   * upsert 의 단조 증가 가드(trade_count/volume) 덕분에 이미 완전한 행을 다시 써도 안전하다.
   */
  @OnEvent(AppEvents.STREAM_STATUS)
  handleStreamStatus(payload: StreamStatusPayload): void {
    // 재연결(연결 복구) 시점만 처리한다.
    if (!payload.connected) {
      return;
    }
    // 같은 이벤트가 스트림 수만큼 발행되므로 kline 스트림만 받아 심볼당 1회로 줄인다.
    const symbol = parseSymbolFromKlineStreamKey(payload.streamKey, this.symbols);
    if (symbol === null) {
      return;
    }
    const disconnectedAt = readIsoDate(payload.meta?.['disconnectedAt']);
    if (disconnectedAt === null) {
      // 최초 연결(ws_open)에는 끊김 구간이 없다 — 기동 백필이 담당한다.
      return;
    }
    const reconnectedAt = readIsoDate(payload.meta?.['reconnectedAt']) ?? payload.at;
    void this.repairDowntimeWindow(symbol, disconnectedAt, reconnectedAt);
  }

  /** 다운타임 구간 강제 복구. 실패해도 주기 갭 스캔이 남은 누락을 다시 시도한다. */
  private async repairDowntimeWindow(
    symbol: SupportedSymbol,
    disconnectedAt: Date,
    reconnectedAt: Date,
  ): Promise<void> {
    // 끊긴 시점이 속한 봉이 부분 저장됐을 수 있으므로 그 봉부터 포함한다.
    const startMs = floorToStep(disconnectedAt.getTime(), BASE_INTERVAL_MS);
    // 복구 시점이 속한 봉은 아직 진행 중이므로 제외한다 (다음 갭 스캔이 확정 후 처리).
    const endMs = floorToStep(reconnectedAt.getTime(), BASE_INTERVAL_MS);
    if (startMs >= endMs) {
      return;
    }

    this.logger.log(
      `${symbol} 다운타임 구간 강제 복구 시작 ` +
        `(${new Date(startMs).toISOString()} ~ ${new Date(endMs).toISOString()})`,
    );
    try {
      const summary = await this.runWindow(symbol, startMs, endMs, 'gap_recovery', { force: true });
      const written = summary.jobs.reduce((acc, job) => acc + job.rowsWritten, 0);
      this.logger.log(`${symbol} 다운타임 구간 강제 복구 완료 (${written}행)`);
    } catch (error) {
      this.logger.error(`${symbol} 다운타임 구간 강제 복구 실패: ${toErrorMessage(error)}`);
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

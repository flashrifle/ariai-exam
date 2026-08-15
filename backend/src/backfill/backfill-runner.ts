/**
 * 백필 job 실행기 — job 하나(= 갭 구간 하나)의 전체 수명주기를 담당한다.
 * running 전이 → REST 페이지네이션 → upsert → succeeded/failed 확정 (제한된 재시도 포함).
 *
 * REST 호출은 반드시 BinanceRestClient(weight 기반 레이트리미터 내장)를 통해서만 한다.
 * 직접 fetch 는 IP 밴 위험이 있어 금지. 클라이언트 자체의 요청 단위 재시도(429/네트워크)와
 * 별개로, 여기서는 job 단위 재시도를 수행한다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceRestClient } from '../binance/binance-rest.client';
import type { BinanceKline } from '../binance/binance-rest.schemas';
import { BASE_INTERVAL_MS } from '../config/configuration';
import { BackfillJobRepository } from '../db/repositories/backfill-job.repository';
import { KlineRepository } from '../db/repositories/kline.repository';
import { sleep, toErrorMessage } from './async-util';
import {
  KLINES_PAGE_LIMIT,
  MAX_JOB_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
} from './backfill.constants';
import type { BackfillJobResult, BackfillJobSpec } from './backfill.types';
import { capEndToClosedCandles } from './gap-math';
import { isClosedCandle, toKlineInsert } from './kline-mapper';
import { emitBackfillProgress } from './progress-emitter';
import { computeMaxPages, paginateKlines } from './rest-paginator';

@Injectable()
export class BackfillRunner {
  private readonly logger = new Logger(BackfillRunner.name);

  constructor(
    private readonly restClient: BinanceRestClient,
    private readonly klineRepository: KlineRepository,
    private readonly jobRepository: BackfillJobRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** job 을 실행한다. 실패 시 제한된 횟수만 재시도하고, 소진되면 failed 로 확정한다. */
  async runJob(job: BackfillJobSpec): Promise<BackfillJobResult> {
    let lastError = '원인 불명 오류';
    for (let attempt = 1; attempt <= MAX_JOB_ATTEMPTS; attempt += 1) {
      try {
        const rowsWritten = await this.runAttempt(job);
        await this.jobRepository.markSucceeded(job.jobId, rowsWritten);
        emitBackfillProgress(this.eventEmitter, job, 'succeeded', rowsWritten);
        this.logger.log(
          `백필 job ${job.jobId} 성공 (${job.symbol}, ${rowsWritten}행, 시도 ${attempt})`,
        );
        return { jobId: job.jobId, range: job.range, status: 'succeeded', rowsWritten };
      } catch (error) {
        lastError = toErrorMessage(error);
        this.logger.warn(
          `백필 job ${job.jobId} 시도 ${attempt}/${MAX_JOB_ATTEMPTS} 실패: ${lastError}`,
        );
        if (attempt < MAX_JOB_ATTEMPTS) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
        }
      }
    }
    // 재시도 소진 — 조용히 넘어가지 않고 failed 로 남기고 에러 메시지를 기록한다.
    await this.jobRepository.markFailed(job.jobId, lastError);
    emitBackfillProgress(this.eventEmitter, job, 'failed', 0, lastError);
    this.logger.error(`백필 job ${job.jobId} 최종 실패 (${job.symbol}): ${lastError}`);
    return {
      jobId: job.jobId,
      range: job.range,
      status: 'failed',
      rowsWritten: 0,
      error: lastError,
    };
  }

  /** 1회 시도: running 전이 후 구간 전체를 페이지네이션으로 가져와 upsert 한다. */
  private async runAttempt(job: BackfillJobSpec): Promise<number> {
    await this.jobRepository.markRunning(job.jobId);
    emitBackfillProgress(this.eventEmitter, job, 'running', 0);

    // job 생성 시점에 이미 진행 중 봉을 제외했지만, 실행 시점 기준으로 한 번 더 상한 처리한다.
    const endMs = capEndToClosedCandles(job.range.endMs, Date.now(), BASE_INTERVAL_MS);
    let written = 0;

    const result = await paginateKlines<BinanceKline>({
      startMs: job.range.startMs,
      endMs,
      stepMs: BASE_INTERVAL_MS,
      pageLimit: KLINES_PAGE_LIMIT,
      maxPages: computeMaxPages(job.range.startMs, endMs, BASE_INTERVAL_MS, KLINES_PAGE_LIMIT),
      getOpenTimeMs: (kline) => kline.openTime.getTime(),
      fetchPage: (startTimeMs, endTimeMs, limit) =>
        this.restClient.getKlines({
          symbol: job.symbol,
          interval: job.interval,
          startTime: startTimeMs,
          endTime: endTimeMs,
          limit,
        }),
      onPage: async (rows) => {
        written += await this.upsertPage(job, rows);
        // 페이지 단위 진행 상황을 대시보드로 푸시한다 (DB 확정치는 종료 시 기록).
        emitBackfillProgress(this.eventEmitter, job, 'running', written);
      },
    });

    if (result.stopReason === 'cursor_stalled' || result.stopReason === 'max_pages_exceeded') {
      // 커서 이상은 데이터 정합성을 보장할 수 없으므로 실패로 처리해 재시도를 유도한다.
      throw new Error(
        `페이지네이션 비정상 종료(${result.stopReason}) — cursor=${result.nextCursorMs}`,
      );
    }
    return written;
  }

  /** 페이지 한 장을 변환해 source='rest' 로 upsert 한다. 미확정 봉은 저장하지 않는다. */
  private async upsertPage(job: BackfillJobSpec, rows: readonly BinanceKline[]): Promise<number> {
    const nowMs = Date.now();
    const inserts = rows
      .filter((kline) => isClosedCandle(kline, BASE_INTERVAL_MS, nowMs))
      .map((kline) => toKlineInsert(job.symbol, job.interval, kline, BASE_INTERVAL_MS));
    if (inserts.length === 0) {
      return 0;
    }
    return this.klineRepository.upsertMany(inserts);
  }
}

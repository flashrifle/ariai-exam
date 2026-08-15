/**
 * Binance REST 클라이언트 (Node 내장 fetch 사용).
 *
 * 실패 모드 처리:
 * - 모든 요청 전 레이트리미터에서 weight를 확보한다 (예산 초과 시 대기).
 * - 응답 헤더 X-MBX-USED-WEIGHT-1M을 리미터에 반영해 서버 기준으로 보정한다.
 * - 429: Retry-After 동안 전역 정지 후 재시도. 418: 밴 처리 후 즉시 실패.
 * - 네트워크 오류/타임아웃/5xx: 지수 백오프 + 지터로 재시도 (최대 횟수 제한).
 * - 그 외 4xx: 재시도하지 않고 즉시 실패.
 * - 모든 응답은 zod로 검증 후 도메인 객체로 변환한다.
 */
import { Logger } from '@nestjs/common';
import type { SupportedInterval, SupportedSymbol } from '../config/configuration';
import { BackoffPolicy, computeBackoffMs, DEFAULT_BACKOFF_POLICY } from './backoff';
import {
  BinanceKline,
  klinesResponseSchema,
  klinesWeightForLimit,
  mapKlineTuple,
  MAX_KLINES_LIMIT,
  SERVER_TIME_WEIGHT,
  serverTimeResponseSchema,
} from './binance-rest.schemas';
import { describeError } from './error.util';
import { BinanceIpBanError, BinanceRateLimiter } from './rate-limiter';

/** 네트워크 오류/타임아웃 — 재시도 대상. */
export class BinanceNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BinanceNetworkError';
  }
}

/** HTTP 429 — 리미터의 전역 정지 이후 재시도 대상. */
export class BinanceRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BinanceRateLimitError';
  }
}

/** HTTP 5xx — 재시도 대상. */
export class BinanceServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BinanceServerError';
  }
}

/** 429/418을 제외한 4xx — 요청 자체가 잘못된 것이므로 재시도하지 않는다. */
export class BinanceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BinanceHttpError';
  }
}

export interface BinanceRestClientOptions {
  baseUrl: string;
  /** 요청 타임아웃(ms). 기본 10초. */
  timeoutMs?: number;
  /** 최대 시도 횟수 (재시도 포함). 기본 5. */
  maxAttempts?: number;
  backoff?: BackoffPolicy;
}

export interface GetKlinesParams {
  symbol: SupportedSymbol;
  interval: SupportedInterval;
  startTime?: Date | number;
  endTime?: Date | number;
  /** 1~1000. 기본 1000 (백필 최대 페이지). */
  limit?: number;
}

export interface BinanceServerTime {
  serverTime: Date;
  /** 서버시각 - 로컬시각(왕복 중간점 기준). 양수면 로컬 시계가 뒤처진 것. */
  driftMs: number;
  roundTripMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_AFTER_SEC = 5;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function toEpochMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function timeRangeQuery(startTime?: Date | number, endTime?: Date | number): Record<string, string> {
  const query: Record<string, string> = {};
  if (startTime !== undefined) {
    query.startTime = String(toEpochMs(startTime));
  }
  if (endTime !== undefined) {
    query.endTime = String(toEpochMs(endTime));
  }
  return query;
}

export class BinanceRestClient {
  private readonly logger = new Logger(BinanceRestClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoff: BackoffPolicy;

  constructor(
    options: BinanceRestClientOptions,
    private readonly limiter: BinanceRateLimiter,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF_POLICY;
  }

  /** 캔들 조회. limit에 따른 weight를 계산해 리미터에 반영한다. */
  async getKlines(params: GetKlinesParams): Promise<BinanceKline[]> {
    const limit = params.limit ?? MAX_KLINES_LIMIT;
    this.assertLimit(limit, MAX_KLINES_LIMIT);
    const query: Record<string, string> = {
      symbol: params.symbol,
      interval: params.interval,
      limit: String(limit),
      ...timeRangeQuery(params.startTime, params.endTime),
    };
    const json = await this.requestJson('/api/v3/klines', query, klinesWeightForLimit(limit));
    const tuples = klinesResponseSchema.parse(json);
    return tuples.map((tuple) => mapKlineTuple(tuple, params.interval));
  }

  /** 서버 시각 조회 — 로컬 시계와 거래소 시계의 드리프트 측정용. */
  async getServerTime(): Promise<BinanceServerTime> {
    const localBefore = Date.now();
    const json = await this.requestJson('/api/v3/time', {}, SERVER_TIME_WEIGHT);
    const localAfter = Date.now();
    const { serverTime } = serverTimeResponseSchema.parse(json);
    const midpoint = Math.round((localBefore + localAfter) / 2);
    return {
      serverTime: new Date(serverTime),
      driftMs: serverTime - midpoint,
      roundTripMs: localAfter - localBefore,
    };
  }

  private assertLimit(limit: number, max: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      throw new Error(`limit은 1~${max} 사이 정수여야 합니다: ${limit}`);
    }
  }

  /** 레이트리밋 확보 → 요청 → 재시도 오케스트레이션. */
  private async requestJson(
    path: string,
    query: Record<string, string>,
    weight: number,
  ): Promise<unknown> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.limiter.acquire(weight);
      try {
        return await this.fetchOnce(path, query);
      } catch (err) {
        if (!this.isRetryable(err)) {
          throw err;
        }
        lastError = err;
        if (attempt < this.maxAttempts) {
          // 429는 리미터의 전역 정지가 다음 acquire에서 대기를 강제하므로 추가 백오프 없이 재시도
          const waitMs =
            err instanceof BinanceRateLimitError ? 0 : computeBackoffMs(attempt, this.backoff);
          this.logger.warn(
            `REST 요청 실패 (${path}, ${attempt}/${this.maxAttempts}회) — ${waitMs}ms 후 재시도: ${describeError(err)}`,
          );
          if (waitMs > 0) {
            await sleep(waitMs);
          }
        }
      }
    }
    throw new Error(
      `REST 재시도 한도 초과 (${path}, ${this.maxAttempts}회): ${describeError(lastError)}`,
    );
  }

  private async fetchOnce(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    url.search = new URLSearchParams(query).toString();
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new BinanceNetworkError(`네트워크/타임아웃 오류 (${path}): ${describeError(err)}`);
    }
    this.applyWeightHeader(res);
    if (res.ok) {
      return (await res.json()) as unknown;
    }
    return this.raiseHttpError(res, path);
  }

  /** 서버가 알려준 실제 사용량으로 리미터를 보정한다. */
  private applyWeightHeader(res: Response): void {
    const raw = res.headers.get('x-mbx-used-weight-1m');
    if (raw === null) {
      return;
    }
    const used = Number(raw);
    if (Number.isFinite(used)) {
      this.limiter.syncServerUsedWeight(used);
    }
  }

  private async raiseHttpError(res: Response, path: string): Promise<never> {
    const body = await res.text().catch(() => '(본문 읽기 실패)');
    if (res.status === 429) {
      const parsed = Number(res.headers.get('retry-after') ?? '');
      const retryAfterSec = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SEC;
      this.limiter.applyRetryAfter(retryAfterSec);
      throw new BinanceRateLimitError(`429 레이트리밋 (${path}), Retry-After=${retryAfterSec}s`);
    }
    if (res.status === 418) {
      // IP 밴 — 복구 불가 상황. 모든 REST 요청을 중단시키고 명확히 알린다.
      this.limiter.markBanned(`HTTP 418 (${path})`);
      this.logger.error(`HTTP 418 IP 밴 수신 (${path}) — 복구 불가, 수동 개입 필요: ${body}`);
      throw new BinanceIpBanError(`HTTP 418 IP 밴 (${path}): ${body}`);
    }
    if (res.status >= 500) {
      throw new BinanceServerError(`HTTP ${res.status} (${path}): ${body}`);
    }
    throw new BinanceHttpError(res.status, `HTTP ${res.status} (${path}): ${body}`);
  }

  private isRetryable(err: unknown): boolean {
    return (
      err instanceof BinanceNetworkError ||
      err instanceof BinanceServerError ||
      err instanceof BinanceRateLimitError
    );
  }
}

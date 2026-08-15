/**
 * Binance REST weight 기반 레이트리미터.
 *
 * Binance는 IP당 분당 weight 6000을 초과하면 429를, 반복 위반 시 418(IP 밴)을 준다.
 * 밴은 이 시스템에서 치명적 실패이므로:
 * - 슬라이딩 윈도우로 분당 weight 예산을 강제한다.
 * - 응답 헤더 `X-MBX-USED-WEIGHT-1M`이 알려주는 서버 측 실제 사용량으로
 *   내부 카운터를 보정한다 (로컬 추정만 믿지 않는다).
 * - 429의 `Retry-After` 동안 모든 요청을 전역 정지시킨다.
 * - 418 수신 시 밴 상태로 전환해 이후 모든 acquire를 즉시 실패시킨다.
 */
import { Logger } from '@nestjs/common';

/** HTTP 418 — IP 밴. 복구 불가 상황으로 간주하고 상위에서 수동 개입해야 한다. */
export class BinanceIpBanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BinanceIpBanError';
  }
}

export interface RateLimiterOptions {
  /** 분당 weight 예산. Binance 한도(6000)보다 작게 잡아 여유를 둔다. */
  budgetPerMin: number;
  /** 윈도우 길이(ms). 기본 60초. */
  windowMs?: number;
  /** 시계 주입 (테스트용). */
  now?: () => number;
}

interface WeightEntry {
  at: number;
  weight: number;
}

const DEFAULT_WINDOW_MS = 60_000;
/** 대기 재확인 최소 간격 — busy loop 방지. */
const MIN_WAIT_MS = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class BinanceRateLimiter {
  private readonly logger = new Logger(BinanceRateLimiter.name);
  private readonly budgetPerMin: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  private entries: WeightEntry[] = [];
  private pausedUntil = 0;
  private banned = false;
  private bannedReason = '';

  constructor(options: RateLimiterOptions) {
    if (!Number.isFinite(options.budgetPerMin) || options.budgetPerMin <= 0) {
      throw new Error(`잘못된 weight 예산: ${options.budgetPerMin}`);
    }
    this.budgetPerMin = options.budgetPerMin;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * weight 만큼 예산을 확보할 때까지 대기한다.
   * 예산이 없으면 가장 오래된 사용 기록이 윈도우 밖으로 밀려날 때까지 기다린다.
   */
  async acquire(weight: number): Promise<void> {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`잘못된 요청 weight: ${weight}`);
    }
    if (weight > this.budgetPerMin) {
      throw new Error(
        `요청 weight(${weight})가 분당 예산(${this.budgetPerMin})을 초과해 영원히 대기하게 됩니다`,
      );
    }
    for (;;) {
      this.assertNotBanned();
      const now = this.now();
      const pauseMs = this.pausedUntil - now;
      if (pauseMs > 0) {
        // 429 Retry-After 전역 정지 중 — 정지가 풀릴 때까지 대기
        await sleep(pauseMs);
        continue;
      }
      this.prune(now);
      if (this.usedWeight() + weight <= this.budgetPerMin) {
        this.entries.push({ at: now, weight });
        return;
      }
      const oldest = this.entries[0];
      const waitMs = oldest
        ? Math.max(oldest.at + this.windowMs - now, MIN_WAIT_MS)
        : MIN_WAIT_MS;
      await sleep(waitMs);
    }
  }

  /**
   * 응답 헤더 `X-MBX-USED-WEIGHT-1M` 값으로 내부 카운터를 보정한다.
   * 서버 사용량이 로컬 추정보다 크면 차이만큼 보정 엔트리를 추가한다.
   * (서버가 더 적다고 해서 로컬을 줄이지는 않는다 — 초과 방향 오차만 위험하기 때문)
   */
  syncServerUsedWeight(serverUsedWeight: number): void {
    if (!Number.isFinite(serverUsedWeight) || serverUsedWeight < 0) {
      return;
    }
    const now = this.now();
    this.prune(now);
    const local = this.usedWeight();
    if (serverUsedWeight > local) {
      this.entries.push({ at: now, weight: serverUsedWeight - local });
    }
  }

  /** 429 수신 시 Retry-After(초) 동안 모든 acquire를 전역 정지시킨다. */
  applyRetryAfter(retryAfterSec: number): void {
    const sec = Number.isFinite(retryAfterSec) ? Math.max(retryAfterSec, 1) : 1;
    const until = this.now() + sec * 1_000;
    this.pausedUntil = Math.max(this.pausedUntil, until);
    this.logger.warn(`429 레이트리밋 — ${sec}초 동안 모든 REST 요청을 정지합니다`);
  }

  /** 418(IP 밴) 수신 시 호출. 이후 모든 acquire는 BinanceIpBanError를 던진다. */
  markBanned(reason: string): void {
    this.banned = true;
    this.bannedReason = reason;
    this.logger.error(`IP 밴 상태로 전환 — 모든 REST 요청 중단: ${reason}`);
  }

  /** 현재 윈도우에서 사용한 weight 합. */
  getUsedWeight(): number {
    this.prune(this.now());
    return this.usedWeight();
  }

  /** 운영 상태 스냅샷. */
  getStatus(): { usedWeight: number; budgetPerMin: number; pausedForMs: number; banned: boolean } {
    const now = this.now();
    this.prune(now);
    return {
      usedWeight: this.usedWeight(),
      budgetPerMin: this.budgetPerMin,
      pausedForMs: Math.max(this.pausedUntil - now, 0),
      banned: this.banned,
    };
  }

  private assertNotBanned(): void {
    if (this.banned) {
      throw new BinanceIpBanError(`IP 밴 상태입니다 — 요청 불가 (${this.bannedReason})`);
    }
  }

  private prune(now: number): void {
    // 윈도우를 벗어난 기록 제거 (엔트리는 시간순으로 쌓인다)
    this.entries = this.entries.filter((entry) => entry.at + this.windowMs > now);
  }

  private usedWeight(): number {
    return this.entries.reduce((sum, entry) => sum + entry.weight, 0);
  }
}

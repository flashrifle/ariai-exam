/**
 * 목 HTTP 라우터 — **개발 중 화면 확인 전용**.
 * `NEXT_PUBLIC_USE_MOCK=true` 일 때만 `lib/api/client.ts` 에서 동적 import 된다.
 *
 * 실제 백엔드와 동일하게 `ApiResponse<T>` 봉투를 그대로 돌려준다.
 * 그래야 봉투 해제 · zod 검증 경로가 목 모드에서도 똑같이 동작한다.
 */
import {
  buildBackfillJobs,
  buildCandles,
  buildCollectorEvents,
  buildMetricsOverview,
  buildOpsHealth,
} from '@/lib/mock/market-sim';
import type { ApiResponse, BackfillJob, Interval, Symbol as TradingSymbol } from '@/types/api';

type Params = Record<string, string | number | undefined> | undefined;

const LATENCY_MS = 140;

/** 런타임 백필 이력. 수동 트리거가 여기에 쌓인다. */
let backfillJobs: BackfillJob[] = buildBackfillJobs();
let nextJobId = 100;

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(message: string): ApiResponse<null> {
  return { success: false, data: null, error: message };
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}

function readSymbol(params: Params): TradingSymbol {
  return params?.symbol === 'ETHUSDT' ? 'ETHUSDT' : 'BTCUSDT';
}

function readInterval(params: Params): Interval {
  const value = String(params?.interval ?? '1m');
  return value === '5m' || value === '15m' || value === '1h' ? value : '1m';
}

function readLimit(params: Params, fallback: number): number {
  const value = Number(params?.limit ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 1_000) : fallback;
}

export async function mockRequest(
  method: 'GET' | 'POST',
  path: string,
  params: Params,
  body: unknown,
): Promise<unknown> {
  await delay();

  if (method === 'GET') {
    switch (path) {
      case '/candles':
        return ok(buildCandles(readSymbol(params), readInterval(params), readLimit(params, 300)));
      case '/metrics/overview':
        return ok(buildMetricsOverview(readSymbol(params)));
      case '/ops/health':
        return ok(buildOpsHealth());
      case '/ops/backfill-jobs':
        return ok(backfillJobs.slice(0, readLimit(params, 20)));
      case '/ops/events':
        return ok(buildCollectorEvents().slice(0, readLimit(params, 50)));
      default:
        return fail(`목 라우터에 없는 경로입니다: GET ${path}`);
    }
  }

  if (method === 'POST' && path === '/ops/backfill') {
    return ok(createManualJob(body));
  }

  return fail(`목 라우터에 없는 경로입니다: ${method} ${path}`);
}

/** 수동 백필을 큐에 넣고, pending → running → succeeded 로 진행시킨다. */
function createManualJob(body: unknown): BackfillJob {
  const request = (body ?? {}) as Partial<Record<'symbol' | 'interval' | 'from' | 'to', string>>;
  const now = new Date().toISOString();
  const id = (nextJobId += 1);

  const job: BackfillJob = {
    id,
    symbol: request.symbol === 'ETHUSDT' ? 'ETHUSDT' : 'BTCUSDT',
    interval: (request.interval as Interval | undefined) ?? '1m',
    rangeStart: request.from ?? now,
    rangeEnd: request.to ?? now,
    reason: 'manual',
    status: 'pending',
    rowsWritten: 0,
    attempts: 0,
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };

  backfillJobs = [job, ...backfillJobs];
  advance(id, 1_500, (current) => ({
    ...current,
    status: 'running',
    attempts: 1,
    startedAt: new Date().toISOString(),
  }));
  advance(id, 4_500, (current) => ({
    ...current,
    status: 'succeeded',
    rowsWritten: estimateRows(current),
    finishedAt: new Date().toISOString(),
  }));

  return job;
}

function advance(id: number, afterMs: number, update: (job: BackfillJob) => BackfillJob): void {
  setTimeout(() => {
    backfillJobs = backfillJobs.map((job) => (job.id === id ? update(job) : job));
  }, afterMs);
}

function estimateRows(job: BackfillJob): number {
  const from = Date.parse(job.rangeStart);
  const to = Date.parse(job.rangeEnd);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 60_000));
}

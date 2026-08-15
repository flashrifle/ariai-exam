import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.tokens';
import type { Database } from '../../db/db.tokens';
import { ingestState } from '../../db/schema';
import { BASE_INTERVAL, SUPPORTED_SYMBOLS } from '../../config/configuration';
import type { SupportedSymbol } from '../../config/configuration';
import { toNullableIsoString, toNumber } from '../../common/coerce.util';
import { describeError } from '../../common/error.util';
import { extractFirstRow, extractRows } from '../../common/sql.util';
import type { SqlRow } from '../../common/sql.util';
import { INGEST_PORT } from '../../common/ports';
import type { IngestPort } from '../../common/ports';
import type { BackfillSummary, CoverageReport, OpsHealth, StreamHealth } from '../dto/api-types';
import { buildCoverageReport, resolveCoverageWindow } from './coverage.util';
import type { CoverageWindow, MissingGroup } from './coverage.util';
import { fallbackStreamHealth, toStreamHealth } from './stream-health.util';

/**
 * `/ops/health` 계산기.
 *
 * "수집이 실제로 건강한가"를 세 축으로 답한다.
 *  1. 스트림별 연결 상태와 마지막 이벤트 이후 경과 초(lagSeconds)
 *  2. 최근 24시간 1분봉 커버리지 — 기대 1440봉 대비 실제 저장 수와 누락 구간
 *  3. 백필 job 요약 (running/pending/failed24h/lastSucceededAt)
 *
 * 커버리지는 다른 모듈을 거치지 않고 DB에서 직접 계산한다(단일 진실 = 저장된 행).
 */
@Injectable()
export class OpsHealthService {
  private readonly logger = new Logger(OpsHealthService.name);
  private readonly symbols: readonly SupportedSymbol[];

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    @Optional() @Inject(INGEST_PORT) private readonly ingest: IngestPort | null = null,
  ) {
    this.symbols = this.config.get<SupportedSymbol[]>('SYMBOLS') ?? [...SUPPORTED_SYMBOLS];
  }

  async getHealth(): Promise<OpsHealth> {
    const now = new Date();
    const [streams, coverage, backfill] = await Promise.all([
      this.buildStreams(now),
      this.buildCoverage(now),
      this.buildBackfillSummary(),
    ]);

    return {
      serverTime: now.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      streams,
      coverage,
      backfill,
    };
  }

  /* ── 1. 스트림 상태 ─────────────────────────────────────────── */

  private async buildStreams(now: Date): Promise<StreamHealth[]> {
    if (this.ingest !== null) {
      try {
        const snapshots = await this.ingest.getStreamHealth();
        return snapshots.map((snapshot) => toStreamHealth(snapshot, now));
      } catch (error) {
        // 수집 모듈 장애로 health 전체가 죽으면 안 된다. DB 기록으로 대체한다.
        this.logger.warn(`ingest 스트림 상태 조회 실패 — ingest_state 로 대체: ${describeError(error)}`);
      }
    }
    return this.readStreamStateFromDb(now);
  }

  /** ingest 모듈이 아직 바인딩되지 않았을 때의 대체 경로. */
  private async readStreamStateFromDb(now: Date): Promise<StreamHealth[]> {
    const rows = await this.db.select().from(ingestState);
    return rows
      .map((row) => fallbackStreamHealth(row.streamKey, row.lastEventTime, now))
      .filter((entry): entry is StreamHealth => entry !== null)
      .sort((a, b) => a.streamKey.localeCompare(b.streamKey));
  }

  /* ── 2. 커버리지 ────────────────────────────────────────────── */

  private async buildCoverage(now: Date): Promise<CoverageReport[]> {
    const window = resolveCoverageWindow(now);
    return Promise.all(this.symbols.map((symbol) => this.coverageForSymbol(symbol, window)));
  }

  /**
   * 기대 분(generate_series) 과 실제 저장 봉을 LEFT JOIN 해 누락 분을 찾고,
   * gaps-and-islands 기법으로 연속 구간을 묶는다.
   */
  private async coverageForSymbol(
    symbol: SupportedSymbol,
    window: CoverageWindow,
  ): Promise<CoverageReport> {
    const result = await this.db.execute(sql`
      WITH expected AS (
        SELECT gs AS open_time
        FROM generate_series(
          ${window.from}::timestamptz,
          ${window.to}::timestamptz - INTERVAL '1 minute',
          INTERVAL '1 minute'
        ) AS gs
      ),
      missing AS (
        SELECT e.open_time,
               e.open_time
                 - (row_number() OVER (ORDER BY e.open_time))::double precision * INTERVAL '1 minute'
                 AS island
        FROM expected e
        LEFT JOIN klines k
          ON k.symbol = ${symbol}
         AND k.interval = ${BASE_INTERVAL}
         AND k.open_time = e.open_time
        WHERE k.open_time IS NULL
      )
      SELECT min(open_time) AS from_ts,
             max(open_time) AS to_ts,
             count(*)::int  AS minutes
      FROM missing
      GROUP BY island
      ORDER BY min(open_time) ASC
    `);

    const groups = extractRows(result)
      .map(toMissingGroup)
      .filter((group): group is MissingGroup => group !== null);

    return buildCoverageReport(symbol, window, groups);
  }

  /* ── 3. 백필 요약 ───────────────────────────────────────────── */

  private async buildBackfillSummary(): Promise<BackfillSummary> {
    const result = await this.db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'running')::int AS running,
        count(*) FILTER (WHERE status = 'pending')::int AS pending,
        count(*) FILTER (
          WHERE status = 'failed' AND created_at >= now() - INTERVAL '24 hours'
        )::int AS failed_24h,
        max(finished_at) FILTER (WHERE status = 'succeeded') AS last_succeeded_at
      FROM backfill_jobs
    `);

    const row = extractFirstRow(result);
    return {
      running: toNumber(row?.running),
      pending: toNumber(row?.pending),
      failed24h: toNumber(row?.failed_24h),
      lastSucceededAt: toNullableIsoString(row?.last_succeeded_at ?? null),
    };
  }
}

/** 누락 구간 SQL 행 → 순수 계산용 구조체. */
function toMissingGroup(row: SqlRow): MissingGroup | null {
  const from = toNullableIsoString(row.from_ts);
  const to = toNullableIsoString(row.to_ts);
  if (from === null || to === null) {
    return null;
  }
  return { from: new Date(from), to: new Date(to), minutes: toNumber(row.minutes) };
}

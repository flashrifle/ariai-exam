import type { StatusTone } from '@/components/ui/StatusDot';
import type { OpsHealth, StreamHealth } from '@/types/api';

/**
 * 운영 임계값.
 *
 * 1분봉 파이프라인이라 지연 5초까지는 정상 범주로 본다.
 * 15초를 넘으면 다음 봉 경계 전에 복구되지 못할 가능성이 높아 장애로 취급한다.
 */
export const LAG_WARN_SECONDS = 5;
export const LAG_CRITICAL_SECONDS = 15;

/** 24시간 1440봉 기준. 0.999 = 1봉 누락. */
export const COVERAGE_WARN_RATIO = 0.999;
export const COVERAGE_CRITICAL_RATIO = 0.99;

export function lagTone(lagSeconds: number | null, connected: boolean): StatusTone {
  if (!connected) return 'down';
  if (lagSeconds === null) return 'idle';
  if (lagSeconds >= LAG_CRITICAL_SECONDS) return 'down';
  if (lagSeconds >= LAG_WARN_SECONDS) return 'warn';
  return 'ok';
}

export function coverageTone(ratio: number): StatusTone {
  if (ratio < COVERAGE_CRITICAL_RATIO) return 'down';
  if (ratio < COVERAGE_WARN_RATIO) return 'warn';
  return 'ok';
}

export function streamTone(stream: StreamHealth): StatusTone {
  return lagTone(stream.lagSeconds, stream.connected);
}

export interface HealthSummary {
  connectedStreams: number;
  totalStreams: number;
  /** 스트림 중 가장 큰 지연 (초). 모두 null 이면 null. */
  worstLagSeconds: number | null;
  /** 심볼별 커버리지 중 최저치. 커버리지 정보가 없으면 null. */
  worstCoverageRatio: number | null;
  /** 누락 구간 총 개수 */
  totalMissingRanges: number;
  tone: StatusTone;
}

/** 헤드라인 한 줄로 요약하기 위한 집계. */
export function summarizeHealth(health: OpsHealth): HealthSummary {
  const connectedStreams = health.streams.filter((stream) => stream.connected).length;
  const lags = health.streams
    .map((stream) => stream.lagSeconds)
    .filter((lag): lag is number => lag !== null);
  const worstLagSeconds = lags.length > 0 ? Math.max(...lags) : null;

  const ratios = health.coverage.map((entry) => entry.ratio);
  const worstCoverageRatio = ratios.length > 0 ? Math.min(...ratios) : null;
  const totalMissingRanges = health.coverage.reduce(
    (sum, entry) => sum + entry.missingRanges.length,
    0,
  );

  const tones: StatusTone[] = [
    connectedStreams === health.streams.length ? 'ok' : 'down',
    worstLagSeconds === null ? 'idle' : lagTone(worstLagSeconds, true),
    worstCoverageRatio === null ? 'idle' : coverageTone(worstCoverageRatio),
    health.backfill.failed24h > 0 ? 'warn' : 'ok',
  ];

  return {
    connectedStreams,
    totalStreams: health.streams.length,
    worstLagSeconds,
    worstCoverageRatio,
    totalMissingRanges,
    tone: worstTone(tones),
  };
}

const TONE_RANK: Record<StatusTone, number> = { ok: 0, idle: 1, warn: 2, down: 3 };

function worstTone(tones: readonly StatusTone[]): StatusTone {
  return tones.reduce<StatusTone>(
    (worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst),
    'ok',
  );
}

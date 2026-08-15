/**
 * DB row → 프론트 계약 DTO 매핑 (운영 패널용).
 * varchar 로 저장된 열거값은 계약상의 유니온 타입으로 좁혀서 내보낸다.
 */
import { SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from '../../config/configuration';
import type { SupportedInterval, SupportedSymbol } from '../../config/configuration';
import { toIsoString, toNullableIsoString } from '../../common/coerce.util';
import type { BackfillJobRow, CollectorEventRow } from '../../db/schema';
import type {
  BackfillJob,
  BackfillReason,
  BackfillStatus,
  CollectorEvent,
  CollectorEventLevel,
} from '../dto/api-types';

const BACKFILL_REASONS: readonly BackfillReason[] = ['bootstrap', 'gap_recovery', 'manual'];
const BACKFILL_STATUSES: readonly BackfillStatus[] = ['pending', 'running', 'succeeded', 'failed'];
const EVENT_LEVELS: readonly CollectorEventLevel[] = ['info', 'warn', 'error'];

/** 화이트리스트에 없으면 fallback 으로 대체해 계약 타입을 깨뜨리지 않는다. */
function asEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function mapBackfillJobRow(row: BackfillJobRow): BackfillJob {
  return {
    id: Number(row.id),
    symbol: asEnum<SupportedSymbol>(row.symbol, SUPPORTED_SYMBOLS, SUPPORTED_SYMBOLS[0]),
    interval: asEnum<SupportedInterval>(row.interval, SUPPORTED_INTERVALS, SUPPORTED_INTERVALS[0]),
    rangeStart: toIsoString(row.rangeStart),
    rangeEnd: toIsoString(row.rangeEnd),
    reason: asEnum<BackfillReason>(row.reason, BACKFILL_REASONS, 'manual'),
    status: asEnum<BackfillStatus>(row.status, BACKFILL_STATUSES, 'pending'),
    rowsWritten: row.rowsWritten,
    attempts: row.attempts,
    error: row.error ?? null,
    createdAt: toIsoString(row.createdAt),
    startedAt: toNullableIsoString(row.startedAt),
    finishedAt: toNullableIsoString(row.finishedAt),
  };
}

export function mapCollectorEventRow(row: CollectorEventRow): CollectorEvent {
  return {
    id: Number(row.id),
    ts: toIsoString(row.ts),
    level: asEnum<CollectorEventLevel>(row.level, EVENT_LEVELS, 'info'),
    kind: row.kind,
    stream: row.stream ?? null,
    message: row.message,
    meta: asMetaRecord(row.meta),
  };
}

/** jsonb 는 무엇이든 들어올 수 있으므로 객체일 때만 통과시킨다. */
function asMetaRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

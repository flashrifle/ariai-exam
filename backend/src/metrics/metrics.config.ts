/**
 * 지표 모듈 런타임 설정.
 * 환경변수는 backend/src/config/configuration.ts 의 zod 검증을 거쳐 들어오지만,
 * ConfigModule 구성이 바뀌어도 안전하도록 여기서 한 번 더 강제(coerce)한다.
 */
import type { ConfigService } from '@nestjs/config';
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from '../config/configuration';

export interface MetricsRuntimeConfig {
  /** 스냅샷 재계산·발행 주기(ms). METRICS_REFRESH_MS */
  readonly refreshMs: number;
  /** VWAP 등 롤링 지표 윈도우(분). METRICS_WINDOW_MINUTES */
  readonly windowMinutes: number;
  /** 스냅샷을 유지할 심볼 목록. SYMBOLS */
  readonly symbols: readonly SupportedSymbol[];
}

const DEFAULT_REFRESH_MS = 2000;
const DEFAULT_WINDOW_MINUTES = 60;

export function resolveMetricsConfig(config: ConfigService): MetricsRuntimeConfig {
  return {
    refreshMs: readPositiveInt(config, 'METRICS_REFRESH_MS', DEFAULT_REFRESH_MS),
    windowMinutes: readPositiveInt(config, 'METRICS_WINDOW_MINUTES', DEFAULT_WINDOW_MINUTES),
    symbols: readSymbols(config),
  };
}

function readPositiveInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<number | string>(key);
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readSymbols(config: ConfigService): readonly SupportedSymbol[] {
  const raw = config.get<unknown>('SYMBOLS');
  if (Array.isArray(raw)) {
    const valid = raw.filter((symbol): symbol is SupportedSymbol =>
      (SUPPORTED_SYMBOLS as readonly string[]).includes(String(symbol)),
    );
    if (valid.length > 0) return valid;
  }
  return SUPPORTED_SYMBOLS;
}

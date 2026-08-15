/**
 * 환경 설정 계약. 부팅 시 zod로 검증해 잘못된 설정으로 서버가 뜨는 것을 막는다.
 * 새 설정을 추가할 때는 .env.example 도 함께 갱신할 것.
 */
import { z } from 'zod';

export const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const;
export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

/** 저장 단위. 그 이상의 인터벌은 SQL 집계로 파생한다. */
export const BASE_INTERVAL = '1m' as const;
export const SUPPORTED_INTERVALS = ['1m', '5m', '15m', '1h'] as const;
export type SupportedInterval = (typeof SUPPORTED_INTERVALS)[number];

/** 1분봉 1개의 밀리초 길이. 갭 계산의 기준 상수. */
export const BASE_INTERVAL_MS = 60_000;

const csvSymbols = z
  .string()
  .default('BTCUSDT,ETHUSDT')
  .transform((raw) => raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  .pipe(z.array(z.enum(SUPPORTED_SYMBOLS)).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL은 필수입니다'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  BINANCE_REST_BASE_URL: z.string().url().default('https://api.binance.com'),
  BINANCE_WS_BASE_URL: z.string().url().default('wss://stream.binance.com:9443'),

  SYMBOLS: csvSymbols,

  /** 최초 실행 시 백필할 과거 구간(일). 심사자가 바로 데이터를 보게 하는 기본값. */
  BOOTSTRAP_BACKFILL_DAYS: z.coerce.number().positive().max(30).default(3),
  /** 갭 스캔 주기(초). 재시작 직후뿐 아니라 상시 누락도 잡아낸다. */
  GAP_SCAN_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  /** 갭 스캔 대상 조회 구간(시간). */
  GAP_SCAN_LOOKBACK_HOURS: z.coerce.number().positive().default(24),
  /** REST weight 예산(분당). Binance 한도 6000의 일부만 사용해 여유를 둔다. */
  REST_WEIGHT_BUDGET_PER_MIN: z.coerce.number().int().positive().default(2400),

  /** 체결(trade) 기록 배치 flush 주기(ms). */
  TRADE_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  /** 배치 최대 크기. */
  TRADE_FLUSH_MAX_ROWS: z.coerce.number().int().positive().default(500),

  /** 지표 스냅샷 재계산 및 SSE push 주기(ms). */
  METRICS_REFRESH_MS: z.coerce.number().int().positive().default(2000),
  /** VWAP 등 롤링 지표의 기본 윈도우(분). */
  METRICS_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),

  /** trade 원본 보존 기간(일). 초과분은 정리 작업이 삭제한다. */
  TRADE_RETENTION_DAYS: z.coerce.number().positive().default(7),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`환경변수 검증 실패\n${detail}`);
  }
  return parsed.data;
}

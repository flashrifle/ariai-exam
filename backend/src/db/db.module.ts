/**
 * DB 기반 모듈.
 *
 * pg.Pool 하나를 만들어 drizzle 인스턴스를 DRIZZLE 토큰으로 제공하고,
 * 리포지토리들을 함께 노출한다. @Global 이므로 다른 모듈은 import 없이 주입만 하면 된다.
 *
 * 전제: app.module에서 `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` 가
 * 먼저 등록되어야 한다 (ConfigService를 주입받기 때문).
 */
import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { describeConnection } from './connection-info';
import { DRIZZLE, type Database } from './db.tokens';
import { DB_REPOSITORIES } from './repositories';
import * as schema from './schema';

/** pg.Pool 주입 토큰. 종료 처리와 헬스체크에서 pool 자체가 필요하다. */
export const PG_POOL = Symbol('PG_POOL');

const DEFAULT_POOL_MAX = 10;
/** 유휴 커넥션 유지 시간(ms). */
const IDLE_TIMEOUT_MS = 30_000;
/** 커넥션 획득 대기 상한(ms). DB가 죽었을 때 무한 대기하지 않도록 반드시 건다. */
const CONNECTION_TIMEOUT_MS = 10_000;

const poolLogger = new Logger('PgPool');

function readPoolMax(config: ConfigService): number {
  const raw = config.get<number | string>('DB_POOL_MAX');
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_POOL_MAX;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`DB_POOL_MAX는 1 이상의 정수여야 합니다 (받은 값: ${String(raw)})`);
  }
  return parsed;
}

const poolProvider: Provider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Pool => {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL이 설정되지 않았습니다. backend/.env를 확인하세요.');
    }

    const pool = new Pool({
      connectionString,
      max: readPoolMax(config),
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      application_name: 'ariai-collector',
    });

    // 유휴 클라이언트에서 발생한 오류는 핸들러가 없으면 프로세스를 그대로 죽인다.
    // 수집기는 장시간 떠 있어야 하므로 반드시 잡아서 로깅만 하고 넘긴다(pg가 커넥션을 폐기·재생성한다).
    pool.on('error', (error: Error) => {
      poolLogger.error(`유휴 커넥션 오류 — 해당 커넥션은 폐기됩니다: ${error.message}`, error.stack);
    });

    return pool;
  },
};

const drizzleProvider: Provider = {
  provide: DRIZZLE,
  inject: [PG_POOL],
  useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
};

@Global()
@Module({
  providers: [poolProvider, drizzleProvider, ...DB_REPOSITORIES],
  exports: [DRIZZLE, PG_POOL, ...DB_REPOSITORIES],
})
export class DbModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbModule.name);
  private isClosed = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  /** 기동 즉시 연결을 확인해, 잘못된 설정으로 서버가 반쯤 살아 있는 상태를 막는다. */
  async onModuleInit(): Promise<void> {
    const target = describeConnection(this.config.get<string>('DATABASE_URL') ?? '');
    try {
      const client = await this.pool.connect();
      try {
        await client.query('select 1');
      } finally {
        client.release();
      }
      this.logger.log(`DB 연결 확인 완료 — ${target} (pool max=${this.pool.options.max})`);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`DB 연결 실패 — ${target}: ${detail}`);
      throw error;
    }
  }

  /** graceful shutdown: 남은 커넥션을 모두 반납하고 pool을 닫는다. */
  async onModuleDestroy(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;

    try {
      await this.pool.end();
      this.logger.log('DB 커넥션 풀을 정상 종료했습니다');
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`DB 커넥션 풀 종료 중 오류: ${detail}`);
    }
  }
}

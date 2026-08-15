/**
 * 마이그레이션 실행 스크립트 (독립 실행).
 *
 *   npm run db:migrate      →  tsx src/db/migrate.ts
 *
 * drizzle-kit이 생성한 `backend/drizzle` 폴더의 SQL을 순서대로 적용한다.
 * 성공하면 종료코드 0, 실패하면 1을 반환하므로 CI나 컨테이너 기동 스크립트에서 그대로 쓸 수 있다.
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { describeConnection } from './connection-info';

/** drizzle.config.ts 의 `out` 설정과 반드시 일치해야 한다. */
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', 'drizzle');

const logger = new Logger('Migrate');

function readConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL 환경변수가 없습니다. 프로젝트 루트의 .env.example을 backend/.env로 복사하세요.',
    );
  }
  return connectionString;
}

function assertMigrationsExist(): void {
  if (!existsSync(MIGRATIONS_FOLDER)) {
    throw new Error(
      `마이그레이션 폴더가 없습니다: ${MIGRATIONS_FOLDER}\n` +
        '먼저 `npm run db:generate` 로 마이그레이션을 생성하세요.',
    );
  }
}

async function main(): Promise<void> {
  const connectionString = readConnectionString();
  assertMigrationsExist();

  // 마이그레이션은 한 커넥션에서 순차 실행되면 충분하다.
  const pool = new Pool({ connectionString, max: 1 });
  pool.on('error', (error: Error) => {
    logger.error(`커넥션 오류: ${error.message}`, error.stack);
  });

  try {
    logger.log(`마이그레이션 시작 — 대상: ${describeConnection(connectionString)}`);
    logger.log(`마이그레이션 폴더: ${MIGRATIONS_FOLDER}`);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    logger.log('마이그레이션 완료');
  } finally {
    await pool.end();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? error.stack : String(error);
    logger.error('마이그레이션 실패', detail);
    process.exit(1);
  });

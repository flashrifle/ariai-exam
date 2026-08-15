/**
 * DB 주입 계약. 모든 모듈은 이 토큰으로 drizzle 인스턴스를 주입받는다.
 *
 *   constructor(@Inject(DRIZZLE) private readonly db: Database) {}
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');

export type Database = NodePgDatabase<typeof schema>;

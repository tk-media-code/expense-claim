import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

// DATETIME を UTC として往復させる（03-database.md 4.2）。
// これを指定しないと mysql2 が接続のタイムゾーンで解釈し、値が環境に振り回される。
export function createPool(databaseUrl: string): mysql.Pool {
	return mysql.createPool({ uri: databaseUrl, timezone: 'Z' });
}

export function createDatabase(pool: mysql.Pool) {
	return drizzle(pool, { schema, mode: 'default' });
}

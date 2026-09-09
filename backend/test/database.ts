import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import * as schema from '../src/db/schema.js';

// テスト用スキーマは compose の MySQL の中に作る（07-development.md 4章）。
// 本番と同じエンジン・同じ照合順序で確かめるためで、SQLite へ差し替えない。
export const TEST_DB_NAME = process.env.TEST_MYSQL_DATABASE ?? 'expense_claim_test';
export const MYSQL_HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
export const MYSQL_PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
export const MYSQL_USER = process.env.MYSQL_USER ?? 'expense';
export const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? 'expense';
export const MYSQL_ROOT_PASSWORD = process.env.MYSQL_ROOT_PASSWORD ?? 'expense';

// 03-database.md 4.1。既定の utf8mb4_0900_ai_ci は濁点を無視するので使わない。
export const COLLATION = 'utf8mb4_ja_0900_as_cs';

export const TEST_DATABASE_URL = `mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@${MYSQL_HOST}:${MYSQL_PORT}/${TEST_DB_NAME}`;

export function createTestPool(): mysql.Pool {
	return mysql.createPool({ uri: TEST_DATABASE_URL, timezone: 'Z' });
}

export function createTestDatabase(pool: mysql.Pool) {
	return drizzle(pool, { schema, mode: 'default' });
}

export async function truncateAll(pool: mysql.Pool): Promise<void> {
	await pool.query('SET FOREIGN_KEY_CHECKS = 0');
	const [rows] = await pool.query<mysql.RowDataPacket[]>(
		'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = ?',
		[TEST_DB_NAME, 'BASE TABLE'],
	);
	for (const row of rows) {
		const name = String(row.name);
		// マイグレーション台帳は消さない。消すと毎回流し直しになる。
		if (name === '__drizzle_migrations') continue;
		await pool.query(`TRUNCATE TABLE \`${name}\``);
	}
	await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

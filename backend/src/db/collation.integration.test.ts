import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, describe, expect, it } from 'vitest';

import { COLLATION, TEST_DB_NAME, createTestPool } from '../../test/database.js';

// 03-database.md 4.1 は「MySQL の仕様から言えることで、実機では確かめていない」と
// 12章へ未検証として残していた。ここで実機に当てて閉じる。
//
// 効いてくるのは stations.name の UNIQUE である。既定の照合順序のまま張ると、
// 濁点だけが違う別の駅を登録できなくなり、しかも失敗が「重複エラー」なので
// 原因が照合順序だと気づけない。
const pool: Pool = createTestPool();

afterAll(async () => {
	await pool.end();
});

describe('テスト用スキーマの照合順序', () => {
	it(`既定が ${COLLATION} である`, async () => {
		const [rows] = await pool.query<RowDataPacket[]>(
			'SELECT default_collation_name AS collation FROM information_schema.schemata WHERE schema_name = ?',
			[TEST_DB_NAME],
		);
		expect(rows[0]?.collation).toBe(COLLATION);
	});

	it('濁点あり／なしを別の値として扱う', async () => {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT ('か' = 'が' COLLATE ${COLLATION}) AS same`,
		);
		expect(Number(rows[0]?.same)).toBe(0);
	});

	it('半濁点も区別する', async () => {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT ('は' = 'ぱ' COLLATE ${COLLATION}) AS same`,
		);
		expect(Number(rows[0]?.same)).toBe(0);
	});

	// MySQL 8.4 の既定を使っていたらどうなっていたか。
	// ai は accent-insensitive で、日本語では濁点がアクセントとして無視される。
	it('MySQL の既定 utf8mb4_0900_ai_ci なら同じ値になってしまう', async () => {
		const [rows] = await pool.query<RowDataPacket[]>(
			"SELECT ('か' = 'が' COLLATE utf8mb4_0900_ai_ci) AS same",
		);
		expect(Number(rows[0]?.same)).toBe(1);
	});
});

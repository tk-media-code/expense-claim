import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
	COLLATION,
	TEST_DB_NAME,
	createTestDatabase,
	createTestPool,
	truncateAll,
} from '../../test/database.js';
import { stations } from './schema.js';

// 03-database.md 4.1 は「スキーマを最初に流すときに、濁点違いの2駅を入れて確かめる」と
// 宿題を残していた。collation.integration.test.ts は文字列の比較までしか見ていないので、
// ここで実テーブルの UNIQUE (name) に当てて閉じる。
//
// 駅名は設計書と同じ架空の値だけを使う。実在の駅名は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-09-11T00:00:00Z');

async function insertStation(name: string): Promise<void> {
	await db.insert(stations).values({ name, createdAt: at, updatedAt: at });
}

async function countStations(): Promise<number> {
	const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM stations');
	return Number(rows[0]?.count);
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('stations', () => {
	// Drizzle の MySQL 方言では列に照合順序を付けられないので、スキーマの既定を継ぐしかない。
	// 継いでいなければ、下の「濁点だけが違う」が UNIQUE で落ちる。
	it(`name の照合順序が ${COLLATION} である`, async () => {
		const [rows] = await pool.query<RowDataPacket[]>(
			'SELECT collation_name AS collation FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
			[TEST_DB_NAME, 'stations', 'name'],
		);
		expect(rows[0]?.collation).toBe(COLLATION);
	});

	// Drizzle は mysql2 のエラーを DrizzleQueryError で包み、元のエラーを cause に持つ。
	// 1-3 の登録 API が 409 に写すのはこの code なので、ここでも同じものを見る。
	it('同じ名前は UNIQUE で弾く（03-database.md 5.1）', async () => {
		await insertStation('X鉄乙駅');
		const error: unknown = await insertStation('X鉄乙駅').then(
			() => null,
			(cause: unknown) => cause,
		);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({
			code: 'ER_DUP_ENTRY',
			sqlMessage: expect.stringContaining('stations_name_unique') as unknown,
		});
	});

	// 03-database.md 4.1 の宿題。MySQL 既定の utf8mb4_0900_ai_ci なら「重複エラー」で落ちる。
	it('濁点だけが違う駅名は別の行として入る', async () => {
		await insertStation('X鉄か駅');
		await insertStation('X鉄が駅');
		await expect(countStations()).resolves.toBe(2);
	});

	// F-15。乗換駅は鉄道会社ごとに別の駅として書かれる（要求分析 5.2）。
	it('鉄道会社の略称が違えば、同じ駅名でも別の行として入る', async () => {
		await insertStation('X鉄乙駅');
		await insertStation('Y鉄乙駅');
		await expect(countStations()).resolves.toBe(2);
	});
});

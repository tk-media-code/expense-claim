import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
	COLLATION,
	TEST_DB_NAME,
	createTestDatabase,
	createTestPool,
	truncateAll,
} from '../../test/database.js';
import { venues } from './schema.js';

// 03-database.md 5.1 の venues。会場マスタの取り込み（F-13 / 8-2）が code を鍵に upsert するので、
// UNIQUE (code) が実テーブルで効いていることをここで固定する。
//
// 会場コード・会場名は設計書と同じ架空の値だけを使う。実在の値は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-09-14T00:00:00Z');

async function insertVenue(
	code: string,
	name: string,
	source: 'master' | 'manual' = 'master',
): Promise<void> {
	await db.insert(venues).values({ code, name, source, createdAt: at, updatedAt: at });
}

// Drizzle は mysql2 のエラーを DrizzleQueryError で包み、元のエラーを cause に持つ。
// 失敗を期待するテストは、これで取り出した cause の code を見る。
function rejection(query: PromiseLike<unknown>): Promise<unknown> {
	return Promise.resolve(query).then(
		() => null,
		(cause: unknown) => cause,
	);
}

async function countVenues(): Promise<number> {
	const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM venues');
	return Number(rows[0]?.count);
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('venues', () => {
	// Drizzle の MySQL 方言では列に照合順序を付けられないので、スキーマの既定を継ぐしかない
	// （stations と同じ）。会場コードは英数字で、大小を区別する照合順序でないと AAA と aaa が同じ値になる。
	it.each(['code', 'name'])(`%s の照合順序が ${COLLATION} である`, async (column) => {
		const [rows] = await pool.query<RowDataPacket[]>(
			'SELECT collation_name AS collation FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
			[TEST_DB_NAME, 'venues', column],
		);
		expect(rows[0]?.collation).toBe(COLLATION);
	});

	// 03-database.md 5.1。取り込みの upsert が鍵にする列なので、重複は DB が拒む
	it('同じ会場コードは UNIQUE で弾く', async () => {
		await insertVenue('AAA', '甲ホール');
		const error = await rejection(insertVenue('AAA', '乙ホール'));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({
			code: 'ER_DUP_ENTRY',
			sqlMessage: expect.stringContaining('venues_code_unique') as unknown,
		});
		await expect(countVenues()).resolves.toBe(1);
	});

	// F-13 / F-14。マスタ由来と自分で追加した会場が同じテーブルに並ぶ
	it('source は master と manual の両方が入る', async () => {
		await insertVenue('AAA', '甲ホール', 'master');
		await insertVenue('DDD', '丁ホール', 'manual');
		await expect(countVenues()).resolves.toBe(2);
	});

	// 03-database.md 5.1 の ENUM('master','manual')。アプリの型を迂回して生 SQL で入れても、DB が拒む。
	// sql_mode が strict でなければ空文字に丸められて通ってしまうので、compose の MySQL が
	// 既定のままであることもここで固定する（segments の負の運賃と同じ理由）
	it('source に master / manual 以外は入らない', async () => {
		const error = await rejection(
			pool.query(
				'INSERT INTO venues (code, name, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
				['AAA', '甲ホール', 'mail', at, at],
			),
		);
		expect(error).toBeInstanceOf(Error);
		// MySQL の 1265 を mysql2 は ER_ 抜きの WARN_DATA_TRUNCATED で返す（実測）
		expect(error).toMatchObject({ code: 'WARN_DATA_TRUNCATED' });
		await expect(countVenues()).resolves.toBe(0);
	});
});

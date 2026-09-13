import { eq } from 'drizzle-orm';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { segments, stations } from './schema.js';

// 外部キーを持つテーブルはこれが最初である。03-database.md 6.2 の RESTRICT が、Drizzle の
// references() → drizzle-kit の生成 SQL → 実テーブルと通って効いていることをここで確かめる。
// 1-4 / 1-6 / 1-7 の API が 409 / 422 に写すときに見る cause.code も、ここで固定する。
//
// 駅名は設計書と同じ架空の値だけを使う。実在の駅名は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-09-13T00:00:00Z');

async function insertStation(name: string): Promise<number> {
	const [row] = await db
		.insert(stations)
		.values({ name, createdAt: at, updatedAt: at })
		.$returningId();
	if (!row) throw new Error('駅の insert が id を返さなかった');
	return row.id;
}

async function insertSegment(
	fromStationId: number,
	toStationId: number,
	oneWayFare: number,
): Promise<void> {
	await db
		.insert(segments)
		.values({ fromStationId, toStationId, oneWayFare, createdAt: at, updatedAt: at });
}

// Drizzle は mysql2 のエラーを DrizzleQueryError で包み、元のエラーを cause に持つ。
// 失敗を期待するテストは、これで取り出した cause の code を見る。
function rejection(query: PromiseLike<unknown>): Promise<unknown> {
	return Promise.resolve(query).then(
		() => null,
		(cause: unknown) => cause,
	);
}

async function countRows(table: 'stations' | 'segments'): Promise<number> {
	const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
	return Number(rows[0]?.count);
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('segments', () => {
	// 03-database.md 5.1 / 決定18。同じ駅ペアに運賃を2つ持たせない。1-6 の登録 API が 409 に写す code
	it('同じ駅ペアは UNIQUE で弾く', async () => {
		const from = await insertStation('X鉄甲駅');
		const to = await insertStation('X鉄乙駅');
		await insertSegment(from, to, 320);
		const error = await rejection(insertSegment(from, to, 330));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({
			code: 'ER_DUP_ENTRY',
			sqlMessage: expect.stringContaining(
				'segments_from_station_id_to_station_id_unique',
			) as unknown,
		});
	});

	// 03-database.md 5.1。1-6 の登録 API は同一駅を 422 で先に弾く。DB は二重の網（4.4）
	it('出発駅と到着駅が同じ区間は CHECK で弾く', async () => {
		const station = await insertStation('X鉄甲駅');
		const error = await rejection(insertSegment(station, station, 320));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({
			code: 'ER_CHECK_CONSTRAINT_VIOLATED',
			sqlMessage: expect.stringContaining('segments_from_to_differ') as unknown,
		});
	});

	it('存在しない駅を指す区間は FK で弾く', async () => {
		const from = await insertStation('X鉄甲駅');
		const error = await rejection(insertSegment(from, 999999, 320));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
	});

	// 03-database.md 6.2。stations → segments は RESTRICT。使われている駅を消せてしまうと区間が
	// 壊れる（決定22）。1-4 の駅の削除 API が 409 に写すのはこの code
	it('区間が使っている駅は消せない（RESTRICT）', async () => {
		const from = await insertStation('X鉄甲駅');
		const to = await insertStation('X鉄乙駅');
		await insertSegment(from, to, 320);
		const error = await rejection(db.delete(stations).where(eq(stations.id, to)));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({ code: 'ER_ROW_IS_REFERENCED_2' });
		await expect(countRows('stations')).resolves.toBe(2);
		await expect(countRows('segments')).resolves.toBe(1);
	});

	// RESTRICT が効き過ぎていないこと。設定データは「本人が消したときだけ」消える（6.1）
	it('区間が使っていない駅は消せる', async () => {
		const from = await insertStation('X鉄甲駅');
		const to = await insertStation('X鉄乙駅');
		const unused = await insertStation('Y鉄乙駅');
		await insertSegment(from, to, 320);
		await db.delete(stations).where(eq(stations.id, unused));
		await expect(countRows('stations')).resolves.toBe(2);
	});

	// 03-database.md 4.4。担保の一段目は DB に置ける。sql_mode が strict でなければ 0 に
	// 丸められて通ってしまうので、compose の MySQL が既定のままであることもここで固定する。
	// -500 は要求分析 5.5 で提出シートに書き込めてしまった実測値
	it('負の運賃は UNSIGNED で弾く', async () => {
		const from = await insertStation('X鉄甲駅');
		const to = await insertStation('X鉄乙駅');
		const error = await rejection(insertSegment(from, to, -500));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({ code: 'ER_WARN_DATA_OUT_OF_RANGE' });
		await expect(countRows('segments')).resolves.toBe(0);
	});
});

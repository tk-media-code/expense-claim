import { eq } from 'drizzle-orm';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { routeSegments, routes, segments, stations, venues } from './schema.js';

// 03-database.md 6.2 の ON DELETE がここで出そろう。venues → routes と segments → route_segments の
// RESTRICT、routes → route_segments の CASCADE が、Drizzle の references() → drizzle-kit の生成 SQL →
// 実テーブルと通って効いていることを固定する。1-6 / 1-7 / 2-4 / 2-5 の API が数える・写す先である。
//
// 駅名・会場コード・会場名・ルート名は設計書と同じ架空の値だけを使う。実在の値は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-09-14T00:00:00Z');

async function insertStation(name: string): Promise<number> {
	const [row] = await db
		.insert(stations)
		.values({ name, createdAt: at, updatedAt: at })
		.$returningId();
	if (!row) throw new Error('駅の insert が id を返さなかった');
	return row.id;
}

async function insertSegment(fromStationId: number, toStationId: number): Promise<number> {
	const [row] = await db
		.insert(segments)
		.values({ fromStationId, toStationId, oneWayFare: 320, createdAt: at, updatedAt: at })
		.$returningId();
	if (!row) throw new Error('区間の insert が id を返さなかった');
	return row.id;
}

async function insertVenue(code: string, name: string): Promise<number> {
	const [row] = await db
		.insert(venues)
		.values({ code, name, source: 'master', createdAt: at, updatedAt: at })
		.$returningId();
	if (!row) throw new Error('会場の insert が id を返さなかった');
	return row.id;
}

async function insertRoute(venueId: number, name: string): Promise<number> {
	const [row] = await db
		.insert(routes)
		.values({ venueId, name, createdAt: at, updatedAt: at })
		.$returningId();
	if (!row) throw new Error('ルートの insert が id を返さなかった');
	return row.id;
}

async function insertRouteSegment(
	routeId: number,
	sortOrder: number,
	segmentId: number,
): Promise<void> {
	await db
		.insert(routeSegments)
		.values({ routeId, sortOrder, segmentId, createdAt: at, updatedAt: at });
}

// Drizzle は mysql2 のエラーを DrizzleQueryError で包み、元のエラーを cause に持つ。
// 失敗を期待するテストは、これで取り出した cause の code を見る。
function rejection(query: PromiseLike<unknown>): Promise<unknown> {
	return Promise.resolve(query).then(
		() => null,
		(cause: unknown) => cause,
	);
}

async function countRows(
	table: 'venues' | 'routes' | 'route_segments' | 'segments',
): Promise<number> {
	const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
	return Number(rows[0]?.count);
}

/** 03-database.md 5.1 の例と同じ形。X鉄甲駅→X鉄乙駅 を2本のルートが共有する下ごしらえ */
async function setUpSharedSegment() {
	const from = await insertStation('X鉄甲駅');
	const to = await insertStation('X鉄乙駅');
	const shared = await insertSegment(from, to);
	const venueA = await insertVenue('AAA', '甲ホール');
	const venueB = await insertVenue('BBB', '乙ホール');
	const routeA = await insertRoute(venueA, '乙駅乗換');
	const routeB = await insertRoute(venueB, '乙駅乗換');
	await insertRouteSegment(routeA, 1, shared);
	await insertRouteSegment(routeB, 1, shared);
	return { shared, venueA, routeA, routeB };
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('routes', () => {
	// 03-database.md 5.1。同じ会場に同じ名前のルートを2本持たせない
	it('同じ会場に同じ名前のルートは UNIQUE で弾く', async () => {
		const venue = await insertVenue('AAA', '甲ホール');
		await insertRoute(venue, '乙駅乗換');
		const error = await rejection(insertRoute(venue, '乙駅乗換'));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({
			code: 'ER_DUP_ENTRY',
			sqlMessage: expect.stringContaining('routes_venue_id_name_unique') as unknown,
		});
		await expect(countRows('routes')).resolves.toBe(1);
	});

	// 決定18。ルートまで多対多にせず、同じ経路でも会場ごとに1本ずつ登録する
	it('別の会場なら同じ名前のルートを登録できる', async () => {
		const venueA = await insertVenue('AAA', '甲ホール');
		const venueB = await insertVenue('BBB', '乙ホール');
		await insertRoute(venueA, '乙駅乗換');
		await insertRoute(venueB, '乙駅乗換');
		await expect(countRows('routes')).resolves.toBe(2);
	});

	// 03-database.md 6.2。venues → routes は RESTRICT。設定データを巻き込みで消さない
	it('ルートのある会場は消せない（RESTRICT）', async () => {
		const { venueA } = await setUpSharedSegment();
		const error = await rejection(db.delete(venues).where(eq(venues.id, venueA)));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({ code: 'ER_ROW_IS_REFERENCED_2' });
		await expect(countRows('venues')).resolves.toBe(2);
		await expect(countRows('routes')).resolves.toBe(2);
	});
});

describe('route_segments', () => {
	// 03-database.md 4.3。順序を持つ子は (親, sort_order) を UNIQUE にする。順序が重複してはいけない
	it('同じルートの同じ順序は UNIQUE で弾く', async () => {
		const from = await insertStation('X鉄甲駅');
		const mid = await insertStation('X鉄乙駅');
		const to = await insertStation('Y鉄丙駅');
		const first = await insertSegment(from, mid);
		const second = await insertSegment(mid, to);
		const venue = await insertVenue('AAA', '甲ホール');
		const route = await insertRoute(venue, '乙駅乗換');
		await insertRouteSegment(route, 1, first);

		const error = await rejection(insertRouteSegment(route, 1, second));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({
			code: 'ER_DUP_ENTRY',
			sqlMessage: expect.stringContaining('route_segments_route_id_sort_order_unique') as unknown,
		});
		await expect(countRows('route_segments')).resolves.toBe(1);
	});

	// 03-database.md 6.2。routes → route_segments は CASCADE。並びはルートの部品だが、
	// 区間の定義そのものは segments にあり、消えない（決定18。運賃は1か所にある）
	it('ルートを消すと並びは消え、区間は残る（CASCADE）', async () => {
		const { routeA } = await setUpSharedSegment();
		await db.delete(routes).where(eq(routes.id, routeA));
		await expect(countRows('routes')).resolves.toBe(1);
		await expect(countRows('route_segments')).resolves.toBe(1);
		await expect(countRows('segments')).resolves.toBe(1);
	});

	// 03-database.md 6.2。segments → route_segments は RESTRICT。他のルートがまだ使っている区間を
	// 消せてしまうと経路が壊れる（決定22）。1-7 の区間の削除 API が 409 に写すのはこの code
	it('ルートが使っている区間は消せない（RESTRICT）', async () => {
		const { shared } = await setUpSharedSegment();
		const error = await rejection(db.delete(segments).where(eq(segments.id, shared)));
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toMatchObject({ code: 'ER_ROW_IS_REFERENCED_2' });
		await expect(countRows('segments')).resolves.toBe(1);
		await expect(countRows('route_segments')).resolves.toBe(2);
	});

	// RESTRICT が効き過ぎていないこと。設定データは「本人が消したときだけ」消える（6.1）
	it('どのルートも使っていない区間は消せる', async () => {
		const { shared } = await setUpSharedSegment();
		const from = await insertStation('Y鉄乙駅');
		const to = await insertStation('Y鉄丙駅');
		const unused = await insertSegment(from, to);
		await db.delete(segments).where(eq(segments.id, unused));
		await expect(countRows('segments')).resolves.toBe(1);
		await expect(db.select().from(segments).where(eq(segments.id, shared))).resolves.toHaveLength(
			1,
		);
	});
});

import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { routeSegments } from '../db/schema.js';
import { errorCatalog } from '../domain/app-error.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 会場・駅名は架空の値だけを使う。実在の値は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
// /api/* に認証が被さる。ログイン済みの Cookie を自動で載せる（test/app.ts）
const app = createAuthedApp(db);

async function json(method: string, path: string, body?: unknown): Promise<Response> {
	return app.request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function created<T = { id: number }>(pending: Promise<Response>): Promise<T> {
	const res = await pending;
	if (res.status !== 201) throw new Error(`下ごしらえに失敗: ${res.status} ${await res.text()}`);
	return (await res.json()) as T;
}

/** 足す順は「駅 → 区間 → ルート」（04-api.md 8章）。会場は手で足す（F-14） */
async function setup() {
	const venue = await created(json('POST', '/api/venues', { code: 'AAA', name: '甲ホール' }));
	const x = await created(json('POST', '/api/stations', { name: 'X鉄甲駅' }));
	const y = await created(json('POST', '/api/stations', { name: 'X鉄乙駅' }));
	const y2 = await created(json('POST', '/api/stations', { name: 'Y鉄乙駅' }));
	const z = await created(json('POST', '/api/stations', { name: 'Y鉄丙駅' }));
	const xy = await created(
		json('POST', '/api/segments', { fromStationId: x.id, toStationId: y.id, oneWayFare: 320 }),
	);
	const yz = await created(
		json('POST', '/api/segments', { fromStationId: y2.id, toStationId: z.id, oneWayFare: 210 }),
	);
	return { venueId: venue.id, xy: xy.id, yz: yz.id };
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('POST /api/routes', () => {
	// 04-api.md 4.7 / 3.2。segmentIds の配列順が並び順で、sort_order はサーバーが振る
	it('201 で区間の中身つきのルートを返し、配列順が並び順になる', async () => {
		const { venueId, xy, yz } = await setup();
		const res = await json('POST', '/api/routes', {
			venueId,
			name: '乙駅乗換',
			segmentIds: [xy, yz],
		});
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toEqual({
			id: expect.any(Number) as unknown,
			venueId,
			name: '乙駅乗換',
			legs: [
				{
					sortOrder: 1,
					segmentId: xy,
					fromStationName: 'X鉄甲駅',
					toStationName: 'X鉄乙駅',
					oneWayFare: 320,
				},
				{
					sortOrder: 2,
					segmentId: yz,
					fromStationName: 'Y鉄乙駅',
					toStationName: 'Y鉄丙駅',
					oneWayFare: 210,
				},
			],
		});
	});

	it('登録したルートが会場の一覧に載る', async () => {
		const { venueId, xy, yz } = await setup();
		const route = await created(
			json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy, yz] }),
		);
		const venues = (await (await app.request('/api/venues')).json()) as {
			venues: { routes: unknown[] }[];
		};
		expect(venues.venues[0]?.routes).toEqual([
			{ id: route.id, name: '乙駅乗換', segmentCount: 2, oneWayTotal: 530 },
		]);
	});

	// 03-database.md 5.1。UNIQUE (route_id, segment_id) は張らない。同じ区間を2回入れられる
	it('同じ区間を2回並べても通り、区間数は2になる', async () => {
		const { venueId, xy } = await setup();
		const res = await json('POST', '/api/routes', { venueId, name: '往復', segmentIds: [xy, xy] });
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toMatchObject({
			legs: [
				{ sortOrder: 1, segmentId: xy },
				{ sortOrder: 2, segmentId: xy },
			],
		});
	});

	it('同じ会場に同じ名前を2回登録すると 409 を返す', async () => {
		const { venueId, xy } = await setup();
		await created(json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy] }));
		const res = await json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy] });
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'ROUTE_NAME_DUPLICATED', message: errorCatalog.ROUTE_NAME_DUPLICATED.message },
		});
	});

	it('別の会場なら同じ名前で登録できる', async () => {
		const { venueId, xy } = await setup();
		const other = await created(json('POST', '/api/venues', { code: 'BBB', name: '乙迎賓館' }));
		await created(json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy] }));
		const res = await json('POST', '/api/routes', {
			venueId: other.id,
			name: '乙駅乗換',
			segmentIds: [xy],
		});
		expect(res.status).toBe(201);
	});

	it.each<[string, (s: Awaited<ReturnType<typeof setup>>) => unknown, string]>([
		['会場が無い', ({ xy }) => ({ name: '乙駅乗換', segmentIds: [xy] }), '会場を選んでください'],
		[
			'ルート名が空',
			({ venueId, xy }) => ({ venueId, name: ' ', segmentIds: [xy] }),
			'ルート名を入れてください',
		],
		['区間が無い', ({ venueId }) => ({ venueId, name: '乙駅乗換' }), '区間を1つ以上並べてください'],
		[
			'区間が空',
			({ venueId }) => ({ venueId, name: '乙駅乗換', segmentIds: [] }),
			'区間を1つ以上並べてください',
		],
		[
			'区間に文字列',
			({ venueId }) => ({ venueId, name: '乙駅乗換', segmentIds: ['1'] }),
			'区間を選んでください',
		],
		[
			'存在しない会場',
			({ venueId, xy }) => ({ venueId: venueId + 100, name: '乙駅乗換', segmentIds: [xy] }),
			'会場が見つかりません',
		],
		[
			'存在しない区間',
			({ venueId, xy }) => ({ venueId, name: '乙駅乗換', segmentIds: [xy, xy + 100] }),
			'区間が見つかりません',
		],
	])('%s なら 422 で項目の文面を返す', async (_label, body, message) => {
		const s = await setup();
		const res = await json('POST', '/api/routes', body(s));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({ error: { code: 'INVALID_VALUE', message } });
		await expect(db.select().from(routeSegments)).resolves.toEqual([]);
	});
});

describe('GET /api/routes/:id', () => {
	it('区間の中身つきで返す', async () => {
		const { venueId, xy, yz } = await setup();
		const route = await created(
			json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [yz, xy] }),
		);
		const res = await app.request(`/api/routes/${route.id}`);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			id: route.id,
			legs: [
				{ sortOrder: 1, segmentId: yz },
				{ sortOrder: 2, segmentId: xy },
			],
		});
	});

	it.each([
		['無い id', '9999'],
		['整数でない id', 'abc'],
	])('%s なら 404 を返す', async (_label, id) => {
		const res = await app.request(`/api/routes/${id}`);
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'NOT_FOUND', message: errorCatalog.NOT_FOUND.message },
		});
	});
});

describe('PUT /api/routes/:id', () => {
	// 04-api.md 4.7 / 3.3。segmentIds の配列ごと置き換える。並べ替えは配列を並べ替えて送り直すだけ
	it('200 で置き換えたルートを返し、並びが配列順になる', async () => {
		const { venueId, xy, yz } = await setup();
		const route = await created(
			json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy, yz] }),
		);
		const res = await json('PUT', `/api/routes/${route.id}`, {
			venueId,
			name: '乙駅経由',
			segmentIds: [yz],
		});
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			id: route.id,
			venueId,
			name: '乙駅経由',
			legs: [
				{
					sortOrder: 1,
					segmentId: yz,
					fromStationName: 'Y鉄乙駅',
					toStationName: 'Y鉄丙駅',
					oneWayFare: 210,
				},
			],
		});
		// 古い並びは残っていない
		await expect(db.select().from(routeSegments)).resolves.toHaveLength(1);
	});

	it('紐づく会場も変えられる', async () => {
		const { venueId, xy } = await setup();
		const other = await created(json('POST', '/api/venues', { code: 'BBB', name: '乙迎賓館' }));
		const route = await created(
			json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy] }),
		);
		const res = await json('PUT', `/api/routes/${route.id}`, {
			venueId: other.id,
			name: '乙駅乗換',
			segmentIds: [xy],
		});
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ venueId: other.id });
	});

	it('自分と同じ名前で送れば 200、他のルートと同じ名前なら 409 を返す', async () => {
		const { venueId, xy } = await setup();
		const a = await created(json('POST', '/api/routes', { venueId, name: 'A', segmentIds: [xy] }));
		await created(json('POST', '/api/routes', { venueId, name: 'B', segmentIds: [xy] }));
		expect(
			(await json('PUT', `/api/routes/${a.id}`, { venueId, name: 'A', segmentIds: [xy] })).status,
		).toBe(200);
		expect(
			(await json('PUT', `/api/routes/${a.id}`, { venueId, name: 'B', segmentIds: [xy] })).status,
		).toBe(409);
	});

	it('存在しない区間を含めると 422 で、並びは元のまま', async () => {
		const { venueId, xy } = await setup();
		const route = await created(
			json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy] }),
		);
		const res = await json('PUT', `/api/routes/${route.id}`, {
			venueId,
			name: '乙駅乗換',
			segmentIds: [xy + 100],
		});
		expect(res.status).toBe(422);
		await expect((await app.request(`/api/routes/${route.id}`)).json()).resolves.toMatchObject({
			legs: [{ segmentId: xy }],
		});
	});

	it('無い id なら 404 を返す', async () => {
		const { venueId, xy } = await setup();
		const res = await json('PUT', '/api/routes/9999', { venueId, name: 'A', segmentIds: [xy] });
		expect(res.status).toBe(404);
	});
});

describe('DELETE /api/routes/:id', () => {
	// 04-api.md 4.7。使う区間の並びだけが消え（CASCADE）、区間そのものは残る
	it('204 で本文を返さず、並びは消えて区間は残る', async () => {
		const { venueId, xy, yz } = await setup();
		const route = await created(
			json('POST', '/api/routes', { venueId, name: '乙駅乗換', segmentIds: [xy, yz] }),
		);
		const res = await app.request(`/api/routes/${route.id}`, { method: 'DELETE' });
		expect(res.status).toBe(204);
		expect(await res.text()).toBe('');
		expect((await app.request(`/api/routes/${route.id}`)).status).toBe(404);
		await expect(db.select().from(routeSegments)).resolves.toEqual([]);
		const segments = (await (await app.request('/api/segments')).json()) as {
			segments: { routeCount: number }[];
		};
		expect(segments.segments).toHaveLength(2);
		expect(segments.segments.every((segment) => segment.routeCount === 0)).toBe(true);
	});

	it('無い id なら 404 を返す', async () => {
		const res = await app.request('/api/routes/9999', { method: 'DELETE' });
		expect(res.status).toBe(404);
	});
});

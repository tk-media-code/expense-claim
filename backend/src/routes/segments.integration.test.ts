import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { routeSegments, routes, venues } from '../db/schema.js';
import { errorCatalog } from '../domain/app-error.js';
import { ONE_WAY_FARE_MAX } from '../domain/segment.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 駅名・会場は架空の値だけを使う。実在の値は書かない（公開リポジトリ）。
// 並びを見るテストは先頭の英字（X < Y < Z）で順序が決まる名前にし、漢字の照合順序に依らないようにする。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
// /api/* に認証が被さる。ログイン済みの Cookie を自動で載せる（test/app.ts）
const app = createAuthedApp(db);

async function post(body: string): Promise<Response> {
	return app.request('/api/segments', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	});
}

/** 駅を登録して id を取る。区間の下ごしらえ。足す順は「駅 → 区間 → ルート」（04-api.md 8章） */
async function createStation(name: string): Promise<number> {
	const res = await app.request('/api/stations', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name }),
	});
	const created = (await res.json()) as { id: number };
	return created.id;
}

async function createSegment(from: number, to: number, oneWayFare = 320): Promise<number> {
	const res = await post(JSON.stringify({ fromStationId: from, toStationId: to, oneWayFare }));
	const created = (await res.json()) as { id: number };
	return created.id;
}

/** ルートに区間を使わせて、routeCount を立てる。ルートの API はまだ無い（2-4）ので DB に直接入れる */
async function useInRoute(segmentId: number): Promise<void> {
	const at = new Date('2026-09-14T00:00:00Z');
	const [venue] = await db
		.insert(venues)
		.values({ code: 'AAA', name: '甲ホール', source: 'master', createdAt: at, updatedAt: at })
		.$returningId();
	if (!venue) throw new Error('会場の insert が id を返さなかった');
	const [route] = await db
		.insert(routes)
		.values({ venueId: venue.id, name: '乙駅乗換', createdAt: at, updatedAt: at })
		.$returningId();
	if (!route) throw new Error('ルートの insert が id を返さなかった');
	await db
		.insert(routeSegments)
		.values({ routeId: route.id, sortOrder: 1, segmentId, createdAt: at, updatedAt: at });
}

async function put(id: number, body: string): Promise<Response> {
	return app.request(`/api/segments/${id}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body,
	});
}

async function list(): Promise<Record<string, unknown>[]> {
	const body = (await (await app.request('/api/segments')).json()) as {
		segments: Record<string, unknown>[];
	};
	return body.segments;
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/segments', () => {
	it('区間が無ければ空の配列を返す', async () => {
		const res = await app.request('/api/segments');
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ segments: [] });
	});

	// 02-screens.md 3.8。出発駅名→到着駅名の順に並び、何本のルートが使っているかを添える
	it('出発駅名→到着駅名の順で、使っているルート数つきで返す', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('Y鉄乙駅');
		const z = await createStation('Z鉄丙駅');
		const yz = await createSegment(y, z, 210);
		const xz = await createSegment(x, z, 500);
		const xy = await createSegment(x, y, 320);
		await useInRoute(xy);

		await expect(list()).resolves.toEqual([
			{
				id: xy,
				fromStationId: x,
				fromStationName: 'X鉄甲駅',
				toStationId: y,
				toStationName: 'Y鉄乙駅',
				oneWayFare: 320,
				routeCount: 1,
			},
			{
				id: xz,
				fromStationId: x,
				fromStationName: 'X鉄甲駅',
				toStationId: z,
				toStationName: 'Z鉄丙駅',
				oneWayFare: 500,
				routeCount: 0,
			},
			{
				id: yz,
				fromStationId: y,
				fromStationName: 'Y鉄乙駅',
				toStationId: z,
				toStationName: 'Z鉄丙駅',
				oneWayFare: 210,
				routeCount: 0,
			},
		]);
	});
});

describe('POST /api/segments', () => {
	it('201 で登録した区間を駅名つきで返し、一覧に出る', async () => {
		const from = await createStation('X鉄甲駅');
		const to = await createStation('X鉄乙駅');

		const res = await post(
			JSON.stringify({ fromStationId: from, toStationId: to, oneWayFare: 320 }),
		);
		expect(res.status).toBe(201);
		expect(res.headers.get('content-type')).toContain('application/json');
		const created: unknown = await res.json();
		expect(created).toEqual({
			id: expect.any(Number) as unknown,
			fromStationId: from,
			fromStationName: 'X鉄甲駅',
			toStationId: to,
			toStationName: 'X鉄乙駅',
			oneWayFare: 320,
			routeCount: 0,
		});
		await expect(list()).resolves.toEqual([created]);
	});

	it.each([
		['0円', 0],
		['INT UNSIGNED の上限', ONE_WAY_FARE_MAX],
	])('片道運賃が %s なら通る', async (_label, oneWayFare) => {
		const from = await createStation('X鉄甲駅');
		const to = await createStation('X鉄乙駅');
		const res = await post(JSON.stringify({ fromStationId: from, toStationId: to, oneWayFare }));
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toMatchObject({ oneWayFare });
	});

	// 04-api.md 4.7 / 決定18。同じ駅ペアに運賃を2つ持たせない
	it('同じ駅ペアを2回登録すると 409 を返し、運賃は元のまま', async () => {
		const from = await createStation('X鉄甲駅');
		const to = await createStation('X鉄乙駅');
		await createSegment(from, to, 320);

		const res = await post(
			JSON.stringify({ fromStationId: from, toStationId: to, oneWayFare: 330 }),
		);
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'SEGMENT_DUPLICATED', message: errorCatalog.SEGMENT_DUPLICATED.message },
		});
		await expect(list()).resolves.toEqual([expect.objectContaining({ oneWayFare: 320 })]);
	});

	// 決定28。区間は「自宅→会場」の向きで1つだけ持ち、逆向きは同じ区間。文面でその規則を言う
	it('逆向きの駅ペアを登録すると 409 を返し、向きの規則が分かる文面になる', async () => {
		const from = await createStation('X鉄甲駅');
		const to = await createStation('X鉄乙駅');
		await createSegment(from, to, 320);

		const res = await post(
			JSON.stringify({ fromStationId: to, toStationId: from, oneWayFare: 320 }),
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('SEGMENT_DUPLICATED');
		expect(body.error.message).toContain('逆向き');
		expect(body.error.message).toContain('自宅→会場');
		await expect(list()).resolves.toHaveLength(1);
	});

	// 04-api.md 2.5。INVALID_VALUE は項目ごとの文面で、本人が何を直せばよいか分かるようにする。
	// 駅 id は登録して初めて決まるので、本文は id を受け取って組み立てる
	it.each<[string, (from: number, to: number) => Record<string, unknown>, string]>([
		[
			'出発駅が無い',
			(_from, to) => ({ toStationId: to, oneWayFare: 320 }),
			'出発駅を選んでください',
		],
		[
			'出発駅が文字列',
			(from, to) => ({ fromStationId: String(from), toStationId: to, oneWayFare: 320 }),
			'出発駅を選んでください',
		],
		[
			'出発駅が 0',
			(_from, to) => ({ fromStationId: 0, toStationId: to, oneWayFare: 320 }),
			'出発駅を選んでください',
		],
		[
			'到着駅が小数',
			(from) => ({ fromStationId: from, toStationId: 1.5, oneWayFare: 320 }),
			'到着駅を選んでください',
		],
		[
			'出発駅と到着駅が同じ',
			(from) => ({ fromStationId: from, toStationId: from, oneWayFare: 320 }),
			'出発駅と到着駅は別の駅にしてください',
		],
		[
			'片道運賃が無い',
			(from, to) => ({ fromStationId: from, toStationId: to }),
			'片道運賃を入れてください',
		],
		[
			'片道運賃が文字列',
			(from, to) => ({ fromStationId: from, toStationId: to, oneWayFare: '320' }),
			'片道運賃を入れてください',
		],
		[
			'片道運賃が負',
			(from, to) => ({ fromStationId: from, toStationId: to, oneWayFare: -500 }),
			'片道運賃は0以上で入れてください',
		],
		[
			'片道運賃が小数',
			(from, to) => ({ fromStationId: from, toStationId: to, oneWayFare: 320.5 }),
			'片道運賃は整数で入れてください',
		],
		[
			'片道運賃が上限超え',
			(from, to) => ({ fromStationId: from, toStationId: to, oneWayFare: ONE_WAY_FARE_MAX + 1 }),
			'片道運賃が大きすぎます',
		],
	])('%s なら 422 で項目の文面を返す', async (_label, body, message) => {
		const from = await createStation('X鉄甲駅');
		const to = await createStation('X鉄乙駅');
		const res = await post(JSON.stringify(body(from, to)));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({ error: { code: 'INVALID_VALUE', message } });
		await expect(list()).resolves.toEqual([]);
	});

	// 04-api.md 4.7。本文の駅 id は URL の :id と違い本文の値の問題なので、404 でなく 422 にする
	it.each([
		[
			'出発駅',
			(missing: number, other: number) => ({ from: missing, to: other }),
			'出発駅が見つかりません',
		],
		[
			'到着駅',
			(missing: number, other: number) => ({ from: other, to: missing }),
			'到着駅が見つかりません',
		],
	])('%s が存在しない駅なら 422 で「見つかりません」と返す', async (_label, pair, message) => {
		const other = await createStation('X鉄甲駅');
		const { from, to } = pair(other + 1000, other);
		const res = await post(
			JSON.stringify({ fromStationId: from, toStationId: to, oneWayFare: 320 }),
		);
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({ error: { code: 'INVALID_VALUE', message } });
	});

	it('本文がオブジェクトでなければ 422 の既定の文面を返す', async () => {
		const res = await post(JSON.stringify([1, 2, 320]));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: errorCatalog.INVALID_VALUE.message },
		});
	});

	// 04-api.md 2.5 の 400。壊れた JSON を 500 にしない
	it('本文が JSON として壊れていれば 400 を共通のエラー形式で返す', async () => {
		const res = await post('{"fromStationId": ');
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'BAD_REQUEST', message: errorCatalog.BAD_REQUEST.message },
		});
	});
});

describe('PUT /api/segments/:id', () => {
	it('200 で直した区間を駅名つきで返し、一覧にも反映される', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const id = await createSegment(x, y, 320);

		const res = await put(id, JSON.stringify({ oneWayFare: 330 }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			id,
			fromStationId: x,
			fromStationName: 'X鉄甲駅',
			toStationId: y,
			toStationName: 'X鉄乙駅',
			oneWayFare: 330,
			routeCount: 0,
		});
		await expect(list()).resolves.toEqual([expect.objectContaining({ oneWayFare: 330 })]);
	});

	// 決定18。片道運賃は使われていても直せ、その区間を使う全ルートに効く
	it('使用中の区間でも運賃は直せ、routeCount はそのまま返る', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const id = await createSegment(x, y, 320);
		await useInRoute(id);

		const res = await put(id, JSON.stringify({ oneWayFare: 330 }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ oneWayFare: 330, routeCount: 1 });
	});

	// 04-api.md 4.7。1本でもあれば from / to を送っても 409。黙って経路が変わるのを防ぐ
	it('使用中の区間に駅を送ると 409 を返し、運賃も駅も元のまま', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const z = await createStation('X鉄丙駅');
		const id = await createSegment(x, y, 320);
		await useInRoute(id);

		const res = await put(id, JSON.stringify({ oneWayFare: 330, toStationId: z }));
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: {
				code: 'SEGMENT_IN_USE',
				message: 'この区間を使っているルートがあるため、出発駅・到着駅は変えられません',
			},
		});
		await expect(list()).resolves.toEqual([
			expect.objectContaining({ toStationId: y, oneWayFare: 320 }),
		]);
	});

	it('未使用なら駅も差し替えられる', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const z = await createStation('X鉄丙駅');
		const id = await createSegment(x, y, 320);

		const res = await put(
			id,
			JSON.stringify({ oneWayFare: 410, fromStationId: y, toStationId: z }),
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			fromStationName: 'X鉄乙駅',
			toStationName: 'X鉄丙駅',
			oneWayFare: 410,
		});
	});

	it('片方だけ送って同一駅になれば 422 を返す', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const id = await createSegment(x, y, 320);

		const res = await put(id, JSON.stringify({ oneWayFare: 320, fromStationId: y }));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: '出発駅と到着駅は別の駅にしてください' },
		});
	});

	it('他の区間と同じ駅ペアにすると 409 を返す', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const z = await createStation('X鉄丙駅');
		await createSegment(x, y, 320);
		const xz = await createSegment(x, z, 500);

		const res = await put(xz, JSON.stringify({ oneWayFare: 500, toStationId: y }));
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toMatchObject({ error: { code: 'SEGMENT_DUPLICATED' } });
	});

	it('自分と同じ駅ペアで送れば 200 を返す', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const id = await createSegment(x, y, 320);

		const res = await put(
			id,
			JSON.stringify({ oneWayFare: 320, fromStationId: x, toStationId: y }),
		);
		expect(res.status).toBe(200);
	});

	it('負の運賃なら 422 で項目の文面を返す', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const id = await createSegment(x, y, 320);

		const res = await put(id, JSON.stringify({ oneWayFare: -1 }));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: '片道運賃は0以上で入れてください' },
		});
	});

	it.each([
		['無い id', '9999'],
		['整数でない id', 'abc'],
	])('%s なら 404 を返す', async (_label, id) => {
		const res = await app.request(`/api/segments/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ oneWayFare: 320 }),
		});
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'NOT_FOUND', message: errorCatalog.NOT_FOUND.message },
		});
	});
});

describe('DELETE /api/segments/:id', () => {
	// 04-api.md 2.3。消したものを返す意味が無いので本文を持たない
	it('204 で本文を返さず、一覧から消える', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const id = await createSegment(x, y, 320);

		const res = await app.request(`/api/segments/${id}`, { method: 'DELETE' });
		expect(res.status).toBe(204);
		expect(await res.text()).toBe('');
		await expect(list()).resolves.toEqual([]);
	});

	// 決定22。使われている区間は消せない。RESTRICT を 409 として言い直す
	it('使っているルートがあれば 409 を返し、区間は残る', async () => {
		const x = await createStation('X鉄甲駅');
		const y = await createStation('X鉄乙駅');
		const id = await createSegment(x, y, 320);
		await useInRoute(id);

		const res = await app.request(`/api/segments/${id}`, { method: 'DELETE' });
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'SEGMENT_IN_USE', message: errorCatalog.SEGMENT_IN_USE.message },
		});
		await expect(list()).resolves.toHaveLength(1);
	});

	it('無い id なら 404 を返す', async () => {
		const res = await app.request('/api/segments/9999', { method: 'DELETE' });
		expect(res.status).toBe(404);
	});
});

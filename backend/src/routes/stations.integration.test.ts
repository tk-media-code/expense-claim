import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { createApp } from '../app.js';
import { segments } from '../db/schema.js';
import { errorCatalog } from '../domain/app-error.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 駅名は架空の値だけを使う。実在の駅名は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
const app = createApp({ db });

async function post(body: string): Promise<Response> {
	return app.request('/api/stations', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	});
}

async function put(id: number | string, body: string): Promise<Response> {
	return app.request(`/api/stations/${id}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body,
	});
}

async function del(id: number | string): Promise<Response> {
	return app.request(`/api/stations/${id}`, { method: 'DELETE' });
}

/** 登録して id を取る。PUT / DELETE の下ごしらえ */
async function createStation(name: string): Promise<number> {
	const created = (await (await post(JSON.stringify({ name }))).json()) as { id: number };
	return created.id;
}

/** 区間を1本足して、その駅を「使用中」にする。区間の API はまだ無い（1-6） */
async function createSegment(fromStationId: number, toStationId: number): Promise<void> {
	const at = new Date('2026-09-14T00:00:00Z');
	await db
		.insert(segments)
		.values({ fromStationId, toStationId, oneWayFare: 320, createdAt: at, updatedAt: at });
}

async function listNames(): Promise<string[]> {
	const body = (await (await app.request('/api/stations')).json()) as {
		stations: { name: string }[];
	};
	return body.stations.map((station) => station.name);
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/stations', () => {
	it('駅が無ければ空の配列を返す', async () => {
		const res = await app.request('/api/stations');
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ stations: [] });
	});
});

describe('POST /api/stations', () => {
	it('201 で登録した駅を返し、一覧に出る', async () => {
		const res = await post(JSON.stringify({ name: 'X鉄乙駅' }));
		expect(res.status).toBe(201);
		expect(res.headers.get('content-type')).toContain('application/json');
		const created: unknown = await res.json();
		expect(created).toEqual({
			id: expect.any(Number) as unknown,
			name: 'X鉄乙駅',
			segmentCount: 0,
		});

		const list = await app.request('/api/stations');
		await expect(list.json()).resolves.toEqual({ stations: [created] });
	});

	it('前後の空白は落として保存する', async () => {
		const res = await post(JSON.stringify({ name: '  X鉄乙駅　' }));
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toMatchObject({ name: 'X鉄乙駅' });
	});

	// 04-api.md 2.5。INVALID_VALUE は項目ごとの文面で、本人が何を直せばよいか分かるようにする。
	it.each([
		['名前が無い', JSON.stringify({})],
		['名前が空', JSON.stringify({ name: '' })],
		['名前が空白だけ', JSON.stringify({ name: ' 　 ' })],
		['名前が文字列でない', JSON.stringify({ name: 5 })],
	])('%s なら 422 で「駅名を入れてください」', async (_label, body) => {
		const res = await post(body);
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: '駅名を入れてください' },
		});
	});

	it('名前が 101 文字なら 422 で長さを言う', async () => {
		const res = await post(JSON.stringify({ name: 'あ'.repeat(101) }));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: '駅名は100文字以内で入れてください' },
		});
	});

	it('名前が 100 文字なら通る', async () => {
		const res = await post(JSON.stringify({ name: 'あ'.repeat(100) }));
		expect(res.status).toBe(201);
	});

	it('本文がオブジェクトでなければ 422 の既定の文面を返す', async () => {
		const res = await post(JSON.stringify('X鉄乙駅'));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: errorCatalog.INVALID_VALUE.message },
		});
	});

	// 04-api.md 2.5 の 400。壊れた JSON を 500 にしない。
	it('本文が JSON として壊れていれば 400 を共通のエラー形式で返す', async () => {
		const res = await post('{"name": ');
		expect(res.status).toBe(400);
		expect(res.headers.get('content-type')).toContain('application/json');
		await expect(res.json()).resolves.toEqual({
			error: { code: 'BAD_REQUEST', message: errorCatalog.BAD_REQUEST.message },
		});
	});

	// 04-api.md 4.7。駅名が既存と重複したら 409。
	it('同じ名前を2回登録すると 409 を返す', async () => {
		await post(JSON.stringify({ name: 'X鉄乙駅' }));
		const res = await post(JSON.stringify({ name: 'X鉄乙駅' }));
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: {
				code: 'STATION_NAME_DUPLICATED',
				message: errorCatalog.STATION_NAME_DUPLICATED.message,
			},
		});
	});

	// F-15 / 要求分析 5.2。乗換駅は鉄道会社ごとに別の駅。
	it('鉄道会社の略称が違えば同じ駅名でも登録できる', async () => {
		await post(JSON.stringify({ name: 'X鉄乙駅' }));
		const res = await post(JSON.stringify({ name: 'Y鉄乙駅' }));
		expect(res.status).toBe(201);
	});
});

describe('PUT /api/stations/:id', () => {
	it('200 で直った駅を返し、一覧にも反映される', async () => {
		const id = await createStation('X鉄乙駅');

		const res = await put(id, JSON.stringify({ name: 'X鉄丙駅' }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ id, name: 'X鉄丙駅', segmentCount: 0 });
		await expect(listNames()).resolves.toEqual(['X鉄丙駅']);
	});

	// 決定22 / F-15。これが 1-4 の主眼。使われている駅は消せないので、
	// 区間を組んだあとに打ち間違いへ気づくとリネーム以外に道が残らない。
	it('区間が使っている駅でも改名でき、segmentCount はそのまま返る', async () => {
		const from = await createStation('X鉄甲駅');
		const to = await createStation('X鉄乙駅');
		await createSegment(from, to);

		const res = await put(to, JSON.stringify({ name: 'X鉄丙駅' }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ id: to, name: 'X鉄丙駅', segmentCount: 1 });
	});

	// 04-api.md 4.7。POST と同じ 409 である。
	it('他の駅と同じ名前にすると 409 を返す', async () => {
		await createStation('X鉄乙駅');
		const id = await createStation('Y鉄乙駅');

		const res = await put(id, JSON.stringify({ name: 'X鉄乙駅' }));
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: {
				code: 'STATION_NAME_DUPLICATED',
				message: errorCatalog.STATION_NAME_DUPLICATED.message,
			},
		});
		await expect(listNames()).resolves.toEqual(['X鉄乙駅', 'Y鉄乙駅']);
	});

	// 重複の判定からは自分自身を除く（04-api.md 4.7）。
	it('自分と同じ名前で送れば 200 を返す', async () => {
		const id = await createStation('X鉄乙駅');
		const res = await put(id, JSON.stringify({ name: 'X鉄乙駅' }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ name: 'X鉄乙駅' });
	});

	it('前後の空白は落として保存する', async () => {
		const id = await createStation('X鉄乙駅');
		const res = await put(id, JSON.stringify({ name: '  X鉄丙駅　' }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ name: 'X鉄丙駅' });
	});

	// 本文の検証は POST と同じ規則の同じ列なので、スキーマを共有している（04-api.md 4.7）。
	it.each([
		['名前が空', JSON.stringify({ name: '' }), 422, '駅名を入れてください'],
		[
			'名前が 101 文字',
			JSON.stringify({ name: 'あ'.repeat(101) }),
			422,
			'駅名は100文字以内で入れてください',
		],
		['JSON として壊れている', '{"name": ', 400, errorCatalog.BAD_REQUEST.message],
	])('本文が %s なら %i を共通のエラー形式で返す', async (_label, body, status, message) => {
		const id = await createStation('X鉄乙駅');
		const res = await put(id, body);
		expect(res.status).toBe(status);
		await expect(res.json()).resolves.toMatchObject({ error: { message } });
	});

	// 04-api.md 2.5。整数でない id はどの行も指さないので、無い駅と同じ 404 に落とす。
	it.each([
		['無い id', '999999'],
		['整数でない id', 'abc'],
		['0', '0'],
		['負の id', '-1'],
		['小数', '1.5'],
	])('%s なら 404 を共通のエラー形式で返す', async (_label, id) => {
		const res = await put(id, JSON.stringify({ name: 'X鉄乙駅' }));
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'NOT_FOUND', message: errorCatalog.NOT_FOUND.message },
		});
	});

	// :id を本文より先に見る。宛先が無いものに本文の良し悪しを言っても始まらない。
	it('id も本文も壊れていれば、本文ではなく id の 404 を返す', async () => {
		const res = await put('abc', '{"name": ');
		expect(res.status).toBe(404);
	});
});

describe('DELETE /api/stations/:id', () => {
	// 04-api.md 2.3。消したものを返す意味が無いので本文を持たない。
	it('204 で本文を返さず、一覧から消える', async () => {
		const id = await createStation('X鉄乙駅');

		const res = await del(id);
		expect(res.status).toBe(204);
		await expect(res.text()).resolves.toBe('');
		await expect(listNames()).resolves.toEqual([]);
	});

	// 決定22 / 03-database.md 6.2 の RESTRICT。使われている駅を消せると区間が壊れる。
	// 並びは先頭の英字（X < Y）で決まる名前にし、漢字の照合順序に依らないようにする。
	it('使っている区間があれば 409 を返し、駅は残る', async () => {
		const from = await createStation('X鉄乙駅');
		const to = await createStation('Y鉄乙駅');
		await createSegment(from, to);

		const res = await del(to);
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'STATION_IN_USE', message: errorCatalog.STATION_IN_USE.message },
		});
		await expect(listNames()).resolves.toEqual(['X鉄乙駅', 'Y鉄乙駅']);
	});

	// 出発駅として使われていても同じ。segmentCount は両方を数える（02-screens.md 3.8）。
	it('出発駅として使われていても 409 を返す', async () => {
		const from = await createStation('X鉄乙駅');
		const to = await createStation('Y鉄乙駅');
		await createSegment(from, to);

		const res = await del(from);
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toMatchObject({ error: { code: 'STATION_IN_USE' } });
	});

	it.each([
		['無い id', '999999'],
		['整数でない id', 'abc'],
		['0', '0'],
		['負の id', '-1'],
	])('%s なら 404 を共通のエラー形式で返す', async (_label, id) => {
		const res = await del(id);
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'NOT_FOUND', message: errorCatalog.NOT_FOUND.message },
		});
	});
});

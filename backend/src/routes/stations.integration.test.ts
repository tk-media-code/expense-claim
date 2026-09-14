import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { createApp } from '../app.js';
import { errorCatalog } from '../domain/app-error.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 駅名は架空の値だけを使う。実在の駅名は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const app = createApp({ db: createTestDatabase(pool) });

async function post(body: string): Promise<Response> {
	return app.request('/api/stations', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	});
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

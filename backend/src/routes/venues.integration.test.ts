import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { createApp } from '../app.js';
import { routeSegments, routes, segments, stations, venues } from '../db/schema.js';
import { errorCatalog } from '../domain/app-error.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 会場コード・会場名・駅名は架空の値だけを使う。実在の値は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
const app = createApp({ db });

const at = new Date('2026-09-14T00:00:00Z');

async function post(body: string): Promise<Response> {
	return app.request('/api/venues', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	});
}

async function list(): Promise<Record<string, unknown>[]> {
	const body = (await (await app.request('/api/venues')).json()) as {
		venues: Record<string, unknown>[];
	};
	return body.venues;
}

/** マスタ由来の会場は取り込み（8-2）が入れる。API はまだ無いので DB に直接入れる */
async function insertMasterVenue(code: string, name: string): Promise<number> {
	const [row] = await db
		.insert(venues)
		.values({ code, name, source: 'master', createdAt: at, updatedAt: at })
		.$returningId();
	if (!row) throw new Error('会場の insert が id を返さなかった');
	return row.id;
}

/** ルートの API はまだ無い（2-4）ので、区間の並びまで DB に直接入れる */
async function insertRoute(venueId: number, name: string, fares: number[]): Promise<number> {
	const [route] = await db
		.insert(routes)
		.values({ venueId, name, createdAt: at, updatedAt: at })
		.$returningId();
	if (!route) throw new Error('ルートの insert が id を返さなかった');
	for (const [index, fare] of fares.entries()) {
		const [from] = await db
			.insert(stations)
			.values({ name: `${name}${index}発`, createdAt: at, updatedAt: at })
			.$returningId();
		const [to] = await db
			.insert(stations)
			.values({ name: `${name}${index}着`, createdAt: at, updatedAt: at })
			.$returningId();
		if (!from || !to) throw new Error('駅の insert が id を返さなかった');
		const [segment] = await db
			.insert(segments)
			.values({
				fromStationId: from.id,
				toStationId: to.id,
				oneWayFare: fare,
				createdAt: at,
				updatedAt: at,
			})
			.$returningId();
		if (!segment) throw new Error('区間の insert が id を返さなかった');
		await db.insert(routeSegments).values({
			routeId: route.id,
			sortOrder: index + 1,
			segmentId: segment.id,
			createdAt: at,
			updatedAt: at,
		});
	}
	return route.id;
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/venues', () => {
	it('会場が無ければ空の配列を返す', async () => {
		const res = await app.request('/api/venues');
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ venues: [] });
	});

	// 04-api.md 4.7。紐づくルート（名前・区間数・片道合計）まで含めて、会場コード順に返す
	it('会場コード順に、紐づくルートの名前・区間数・片道合計つきで返す', async () => {
		const bbb = await insertMasterVenue('BBB', '乙迎賓館');
		const aaa = await insertMasterVenue('AAA', '甲ホール');
		const eee = await insertMasterVenue('EEE', '戊スタジオ');
		const transfer = await insertRoute(aaa, '乙駅乗換', [320, 210]);
		const direct = await insertRoute(bbb, '戊駅直通', [520]);
		const viaD = await insertRoute(bbb, '丁駅乗換', [380, 210]);

		await expect(list()).resolves.toEqual([
			{
				id: aaa,
				code: 'AAA',
				name: '甲ホール',
				source: 'master',
				routes: [{ id: transfer, name: '乙駅乗換', segmentCount: 2, oneWayTotal: 530 }],
			},
			{
				id: bbb,
				code: 'BBB',
				name: '乙迎賓館',
				source: 'master',
				routes: [
					{ id: viaD, name: '丁駅乗換', segmentCount: 2, oneWayTotal: 590 },
					{ id: direct, name: '戊駅直通', segmentCount: 1, oneWayTotal: 520 },
				],
			},
			// ルート0本の会場も出る。画面が「記録できない」と目立たせる（02-screens.md 3.6）
			{ id: eee, code: 'EEE', name: '戊スタジオ', source: 'master', routes: [] },
		]);
	});
});

describe('POST /api/venues', () => {
	// F-14。マスタに無い会場を足せなければ、ルートを紐付けられず記録そのものができない
	it('201 で source が manual の会場を返し、一覧に出る', async () => {
		const res = await post(JSON.stringify({ code: 'DDD', name: '丁会館' }));
		expect(res.status).toBe(201);
		const created: unknown = await res.json();
		expect(created).toEqual({
			id: expect.any(Number) as unknown,
			code: 'DDD',
			name: '丁会館',
			source: 'manual',
			routes: [],
		});
		await expect(list()).resolves.toEqual([created]);
	});

	// 04-api.md 7章。source を受け取らない。送っても manual になる
	it('source を送っても無視して manual にする', async () => {
		const res = await post(JSON.stringify({ code: 'DDD', name: '丁会館', source: 'master' }));
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toMatchObject({ source: 'manual' });
	});

	it('前後の空白は落として保存する', async () => {
		const res = await post(JSON.stringify({ code: ' DDD ', name: ' 丁会館 ' }));
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toMatchObject({ code: 'DDD', name: '丁会館' });
	});

	it('同じ会場コードを2回登録すると 409 を返す', async () => {
		await insertMasterVenue('AAA', '甲ホール');
		const res = await post(JSON.stringify({ code: 'AAA', name: '別の名前' }));
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: {
				code: 'VENUE_CODE_DUPLICATED',
				message: errorCatalog.VENUE_CODE_DUPLICATED.message,
			},
		});
		await expect(list()).resolves.toHaveLength(1);
	});

	it.each([
		['会場コードが無い', { name: '丁会館' }, '会場コードを入れてください'],
		['会場コードが空白だけ', { code: '  ', name: '丁会館' }, '会場コードを入れてください'],
		[
			'会場コードが 17 文字',
			{ code: 'A'.repeat(17), name: '丁会館' },
			'会場コードは16文字以内で入れてください',
		],
		['会場名が無い', { code: 'DDD' }, '会場名を入れてください'],
		[
			'会場名が 256 文字',
			{ code: 'DDD', name: 'あ'.repeat(256) },
			'会場名は255文字以内で入れてください',
		],
	])('%s なら 422 で項目の文面を返す', async (_label, body, message) => {
		const res = await post(JSON.stringify(body));
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({ error: { code: 'INVALID_VALUE', message } });
		await expect(list()).resolves.toEqual([]);
	});

	it('本文が JSON として壊れていれば 400 を共通のエラー形式で返す', async () => {
		const res = await post('{"code": ');
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'BAD_REQUEST', message: errorCatalog.BAD_REQUEST.message },
		});
	});
});

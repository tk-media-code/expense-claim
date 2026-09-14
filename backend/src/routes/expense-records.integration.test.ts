import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { expenseRecordLegs, expenseRecords } from '../db/schema.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 会場・駅名・案件は架空の値だけを使う（公開リポジトリ）。要件定義 5.6 の例に合わせる
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

async function station(name: string): Promise<number> {
	return (await created(json('POST', '/api/stations', { name }))).id;
}
async function segment(from: number, to: number, fare: number): Promise<number> {
	return (
		await created(
			json('POST', '/api/segments', { fromStationId: from, toStationId: to, oneWayFare: fare }),
		)
	).id;
}
async function route(venueId: number, name: string, segmentIds: number[]): Promise<number> {
	return (await created(json('POST', '/api/routes', { venueId, name, segmentIds }))).id;
}
async function project(projectNo: string, venueCode: string): Promise<number> {
	return (
		await created(
			json('POST', '/api/projects', {
				projectNo,
				serviceDate: '2026-09-05',
				venueCode,
				coupleName: '〇〇様△△様',
			}),
		)
	).id;
}

/** 要件定義 5.6。AAA は乙駅乗換1本、BBB は丁駅乗換と戊駅直通の2本 */
async function setup() {
	const aaa = (await created(json('POST', '/api/venues', { code: 'AAA', name: '甲ホール' }))).id;
	const bbb = (await created(json('POST', '/api/venues', { code: 'BBB', name: '乙迎賓館' }))).id;
	const [x, xOtsu, yOtsu, yHei, xTei, yTei, yBo, zBo] = await Promise.all(
		['X鉄甲駅', 'X鉄乙駅', 'Y鉄乙駅', 'Y鉄丙駅', 'X鉄丁駅', 'Y鉄丁駅', 'Y鉄戊駅', 'Z鉄戊駅'].map(
			station,
		),
	);
	const viaOtsu = await route(aaa, '乙駅乗換', [
		await segment(x!, xOtsu!, 320),
		await segment(yOtsu!, yHei!, 210),
	]);
	const viaTei = await route(bbb, '丁駅乗換', [
		await segment(x!, xTei!, 380),
		await segment(yTei!, yBo!, 210),
	]);
	const direct = await route(bbb, '戊駅直通', [await segment(x!, zBo!, 520)]);
	const a = await project('100000001', 'AAA');
	const b = await project('100000002', 'BBB');
	return { viaOtsu, viaTei, direct, a, b };
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/projects/:id/expense-record', () => {
	// 04-api.md 5.2。ルートが1本ならそれが選択済みで、往復の金額まで入って返る
	it('案件・会場のルート・既定値を一式で返す', async () => {
		const { viaOtsu, a } = await setup();
		const res = await app.request(`/api/projects/${a}/expense-record`);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			project: {
				id: a,
				serviceDate: '2026-09-05',
				venueCode: 'AAA',
				venueName: '甲ホール',
				coupleName: '〇〇様△△様',
			},
			routes: [
				{
					id: viaOtsu,
					venueId: expect.any(Number) as unknown,
					name: '乙駅乗換',
					legs: [
						{
							sortOrder: 1,
							segmentId: expect.any(Number) as unknown,
							fromStationName: 'X鉄甲駅',
							toStationName: 'X鉄乙駅',
							oneWayFare: 320,
						},
						{
							sortOrder: 2,
							segmentId: expect.any(Number) as unknown,
							fromStationName: 'Y鉄乙駅',
							toStationName: 'Y鉄丙駅',
							oneWayFare: 210,
						},
					],
				},
			],
			defaults: {
				tripType: 'round',
				outboundRouteId: viaOtsu,
				returnRouteId: viaOtsu,
				legs: [
					{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
					{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
				],
			},
			record: null,
			taxiRides: [],
		});
	});

	it('ルートが2本の会場は未選択で返し、既存の記録があればそれも返す', async () => {
		const { viaTei, direct, b } = await setup();
		await json('PUT', `/api/projects/${b}/expense-record`, {
			tripType: 'one_way',
			outboundRouteId: viaTei,
			returnRouteId: direct,
		});
		const view = (await (await app.request(`/api/projects/${b}/expense-record`)).json()) as {
			defaults: { outboundRouteId: number | null };
			record: { tripType: string; legs: unknown[] } | null;
		};
		expect(view.defaults.outboundRouteId).toBeNull();
		expect(view.record?.tripType).toBe('one_way');
		expect(view.record?.legs).toHaveLength(3);
	});

	it('無い案件なら 404 を返す', async () => {
		expect((await app.request('/api/projects/9999/expense-record')).status).toBe(404);
	});
});

describe('PUT /api/projects/:id/expense-record', () => {
	// 2手の2手目。既定値のまま保存し、保存された区間をそのまま返す（5.3）
	it('往復を保存し、200 で保存された区間を返す', async () => {
		const { viaOtsu, a } = await setup();
		const res = await json('PUT', `/api/projects/${a}/expense-record`, {
			tripType: 'round',
			outboundRouteId: viaOtsu,
			returnRouteId: viaOtsu,
		});
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			id: expect.any(Number) as unknown,
			tripType: 'round',
			outboundRouteId: viaOtsu,
			returnRouteId: viaOtsu,
			recordedAt: expect.any(String) as unknown,
			legs: [
				{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
				{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
			],
		});
	});

	// 要件定義 5.6 の案件 B。復路の反転は記録時に済ませてある（03-database.md 7.3）
	it('片道を保存すると復路が反転して続く', async () => {
		const { viaTei, direct, b } = await setup();
		const res = await json('PUT', `/api/projects/${b}/expense-record`, {
			tripType: 'one_way',
			outboundRouteId: viaTei,
			returnRouteId: direct,
		});
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			legs: [
				{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄丁駅', amount: 380 },
				{ sortOrder: 2, fromStationName: 'Y鉄丁駅', toStationName: 'Y鉄戊駅', amount: 210 },
				{ sortOrder: 3, fromStationName: 'Z鉄戊駅', toStationName: 'X鉄甲駅', amount: 520 },
			],
		});
	});

	// 04-api.md 4.5。作るのも直すのも同じ入口。2回保存しても記録は1件で、行は置き換わる
	it('2回保存しても記録は1件のままで、id を保って区間が置き換わる', async () => {
		const { viaTei, direct, b } = await setup();
		const first = (await (
			await json('PUT', `/api/projects/${b}/expense-record`, {
				tripType: 'round',
				outboundRouteId: viaTei,
			})
		).json()) as { id: number };
		const second = (await (
			await json('PUT', `/api/projects/${b}/expense-record`, {
				tripType: 'one_way',
				outboundRouteId: viaTei,
				returnRouteId: direct,
			})
		).json()) as { id: number; legs: unknown[] };
		expect(second.id).toBe(first.id);
		expect(second.legs).toHaveLength(3);
		await expect(db.select().from(expenseRecords)).resolves.toHaveLength(1);
		await expect(db.select().from(expenseRecordLegs)).resolves.toHaveLength(3);
	});

	// F-20。済んだ記録は動かない。運賃を直しても、記録した時点の金額のまま
	it('保存のあとに区間の運賃を直しても、記録の金額は動かない', async () => {
		const { viaOtsu, a } = await setup();
		await json('PUT', `/api/projects/${a}/expense-record`, {
			tripType: 'round',
			outboundRouteId: viaOtsu,
		});
		const segments = (await (await app.request('/api/segments')).json()) as {
			segments: { id: number; oneWayFare: number }[];
		};
		const xy = segments.segments.find((s) => s.oneWayFare === 320);
		await json('PUT', `/api/segments/${xy?.id}`, { oneWayFare: 999 });
		const view = (await (await app.request(`/api/projects/${a}/expense-record`)).json()) as {
			record: { legs: { amount: number }[] };
		};
		expect(view.record.legs[0]?.amount).toBe(640);
	});

	it.each([
		['往復か片道かが無い', { outboundRouteId: 1 }, '往復か片道かを選んでください'],
		['往路が無い', { tripType: 'round' }, '往路ルートを選んでください'],
		['往路が文字列', { tripType: 'round', outboundRouteId: '1' }, '往路ルートを選んでください'],
	])('%s なら 422 で項目の文面を返す', async (_label, body, message) => {
		const { a } = await setup();
		const res = await json('PUT', `/api/projects/${a}/expense-record`, body);
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({ error: { code: 'INVALID_VALUE', message } });
	});

	it('他の会場のルートを送ると 422 で、記録は残らない', async () => {
		const { viaTei, a } = await setup();
		const res = await json('PUT', `/api/projects/${a}/expense-record`, {
			tripType: 'round',
			outboundRouteId: viaTei,
		});
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: '往路ルートが見つかりません' },
		});
		await expect(db.select().from(expenseRecords)).resolves.toHaveLength(0);
	});
});

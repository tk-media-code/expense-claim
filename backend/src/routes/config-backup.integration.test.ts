import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import type { ConfigBackup } from '../domain/config-backup.js';

// 設定データの控え（NF-11 / 04-api.md 4.10）。書き出したものをそのまま読み込めば元に戻り、
// 読み込みは置き換えで、実績データは触らない。値は架空
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
const { request } = createAuthedApp(db);

async function post(path: string, body: unknown): Promise<Response> {
	return request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function id(pending: Promise<Response>): Promise<number> {
	const res = await pending;
	if (res.status !== 201) throw new Error(`下ごしらえに失敗: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { id: number }).id;
}

/** 駅3・区間2・会場2（マスタ1・手動1）・ルート1 */
async function seed() {
	const x = await id(post('/api/stations', { name: 'X鉄甲駅' }));
	const y = await id(post('/api/stations', { name: 'X鉄乙駅' }));
	const z = await id(post('/api/stations', { name: 'Y鉄丙駅' }));
	const xy = await id(post('/api/segments', { fromStationId: x, toStationId: y, oneWayFare: 320 }));
	const yz = await id(post('/api/segments', { fromStationId: y, toStationId: z, oneWayFare: 210 }));
	const aaa = await id(post('/api/venues', { code: 'AAA', name: '甲ホール' }));
	await id(post('/api/venues', { code: 'DDD', name: '丁会館' }));
	const route = await id(
		post('/api/routes', { venueId: aaa, name: '乙駅乗換', segmentIds: [xy, yz] }),
	);
	return { aaa, route };
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/settings/config-backup', () => {
	it('駅・会場・区間・ルートを名前で結んだ JSON を、ダウンロードとして返す', async () => {
		await seed();
		const res = await request('/api/settings/config-backup');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-disposition')).toMatch(
			/attachment; filename="expense-claim-config-\d{8}\.json"/,
		);
		const backup = (await res.json()) as ConfigBackup;
		expect(backup).toEqual({
			version: 1,
			exportedAt: expect.any(String) as unknown,
			stations: [{ name: 'X鉄乙駅' }, { name: 'X鉄甲駅' }, { name: 'Y鉄丙駅' }],
			venues: [
				{ code: 'AAA', name: '甲ホール', source: 'manual' },
				{ code: 'DDD', name: '丁会館', source: 'manual' },
			],
			segments: [
				{ fromStation: 'X鉄乙駅', toStation: 'Y鉄丙駅', oneWayFare: 210 },
				{ fromStation: 'X鉄甲駅', toStation: 'X鉄乙駅', oneWayFare: 320 },
			],
			routes: [
				{
					venueCode: 'AAA',
					name: '乙駅乗換',
					segments: [
						{ fromStation: 'X鉄甲駅', toStation: 'X鉄乙駅' },
						{ fromStation: 'X鉄乙駅', toStation: 'Y鉄丙駅' },
					],
				},
			],
		});
		// id を含まない。別の DB に持ち込める
		expect(JSON.stringify(backup)).not.toMatch(/"id"/);
	});
});

describe('POST /api/settings/config-backup', () => {
	it('書き出したものを読み込むと元に戻り、id は付け直される', async () => {
		const { route } = await seed();
		const backup = (await (await request('/api/settings/config-backup')).json()) as ConfigBackup;

		// 別のデータに置き換わっている状態から読み込む
		await request(`/api/routes/${route}`, { method: 'DELETE' });
		await id(post('/api/stations', { name: 'Z鉄戊駅' }));

		const res = await post('/api/settings/config-backup', backup);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ stations: 3, venues: 2, segments: 2, routes: 1 });

		const again = (await (await request('/api/settings/config-backup')).json()) as ConfigBackup;
		expect({ ...again, exportedAt: null }).toEqual({ ...backup, exportedAt: null });
		const venues = (await (await request('/api/venues')).json()) as {
			venues: {
				code: string;
				routes: { name: string; segmentCount: number; oneWayTotal: number }[];
			}[];
		};
		expect(venues.venues[0]?.routes).toEqual([
			{ id: expect.any(Number) as unknown, name: '乙駅乗換', segmentCount: 2, oneWayTotal: 530 },
		]);
		// Z鉄戊駅 は消えている（追加ではなく置き換え）
		const stations = (await (await request('/api/stations')).json()) as {
			stations: { name: string }[];
		};
		expect(stations.stations.map((s) => s.name)).not.toContain('Z鉄戊駅');
	});

	// 03-database.md 7章。ルートが消えても実績は自立している。読み込みで実績データは触らない
	it('実績データは触らず、記録のルート参照だけが外れる', async () => {
		const { route } = await seed();
		const project = await id(
			post('/api/projects', {
				projectNo: '100000001',
				serviceDate: '2026-09-05',
				venueCode: 'AAA',
				coupleName: '〇〇様△△様',
			}),
		);
		await request(`/api/projects/${project}/expense-record`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tripType: 'round', outboundRouteId: route }),
		});
		const backup = (await (await request('/api/settings/config-backup')).json()) as ConfigBackup;
		await post('/api/settings/config-backup', backup);

		const detail = (await (await request(`/api/projects/${project}`)).json()) as {
			record: { total: number; outboundRouteName: string | null };
		};
		expect(detail.record.total).toBe(1060);
		expect(detail.record.outboundRouteName).toBeNull();
	});

	it('駅一覧に無い駅を指す区間があれば 422 で、何も置き換えない', async () => {
		await seed();
		const res = await post('/api/settings/config-backup', {
			version: 1,
			stations: [{ name: 'A駅' }],
			venues: [],
			segments: [{ fromStation: 'A駅', toStation: 'B駅', oneWayFare: 100 }],
			routes: [],
		});
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: 'INVALID_VALUE', message: expect.stringContaining('B駅') as unknown },
		});
		const stations = (await (await request('/api/stations')).json()) as { stations: unknown[] };
		expect(stations.stations).toHaveLength(3);
	});

	it('version が違えば 422', async () => {
		const res = await post('/api/settings/config-backup', {
			version: 2,
			stations: [],
			venues: [],
			segments: [],
			routes: [],
		});
		expect(res.status).toBe(422);
	});
});

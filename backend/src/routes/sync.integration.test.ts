import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp, createFakeSheets } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';

// POST /api/sync の月度の検知（04-api.md 4.3 手順1）と、会場マスタの取り込み（4.7）、
// 設定のスプレッドシート名（4.10）を、偽物の提出シートで確かめる
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('POST /api/sync（対象月度）', () => {
	// F-31 / 決定13。A1 が対象月度になり、ホームと設定に出る
	it('A1 を読んで対象月度を持ち、ホームがそれを返す', async () => {
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			createFakeSheets({ targetMonth: '2026-08' }),
		);
		const res = await request('/api/sync', { method: 'POST' });
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			targetMonth: '2026-08',
			rolledOver: false,
			importedCount: 0,
			warnings: [],
		});
		await expect((await request('/api/home')).json()).resolves.toMatchObject({
			targetMonth: '2026-08',
		});
		await expect((await request('/api/settings')).json()).resolves.toMatchObject({
			targetMonth: '2026-08',
			spreadsheetName: '交通費精算',
		});
	});

	// F-32。今読んだ値が前回と違えば、切り替わった
	it('前回と違う月度を読めば rolledOver が真', async () => {
		const first = createAuthedApp(
			db,
			undefined,
			undefined,
			createFakeSheets({ targetMonth: '2026-08' }),
		);
		await first.request('/api/sync', { method: 'POST' });
		const second = createAuthedApp(
			db,
			undefined,
			undefined,
			createFakeSheets({ targetMonth: '2026-09' }),
		);
		const res = await second.request('/api/sync', { method: 'POST' });
		await expect(res.json()).resolves.toMatchObject({
			targetMonth: '2026-09',
			rolledOver: true,
			warnings: [{ code: 'TARGET_MONTH_ROLLED_OVER' }],
		});
	});

	// 04-api.md 2.6 / 06-error-handling.md 3.1。読めなくても 200 で、warnings と要確認事項に残る
	it.each([
		['認可切れ', 'GOOGLE_UNAUTHORIZED', '認可が切れています'],
		['共有停止', 'SHEET_UNREACHABLE', '提出シートに届きませんでした'],
		['A1 が読めない', 'TARGET_MONTH_UNREADABLE', '提出シートに届きませんでした'],
	] as const)(
		'%s なら 200 で warnings と sheet_unreachable の要確認事項を残す',
		async (_label, code, phrase) => {
			const { request } = createAuthedApp(
				db,
				undefined,
				undefined,
				createFakeSheets({ fails: code }),
			);
			const res = await request('/api/sync', { method: 'POST' });
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({ targetMonth: null, warnings: [{ code }] });
			const attentions = (await (await request('/api/attentions?checked=false')).json()) as {
				attentions: { kind: string; detail: string }[];
			};
			expect(attentions.attentions).toHaveLength(1);
			expect(attentions.attentions[0]?.kind).toBe('sheet_unreachable');
			expect(attentions.attentions[0]?.detail).toContain(phrase);
			// 設定は開ける。スプレッドシート名だけが読めない
			await expect((await request('/api/settings')).json()).resolves.toMatchObject({
				spreadsheetName: null,
			});
		},
	);
});

describe('POST /api/venues/import（F-13）', () => {
	// 03-database.md 5.1。code を鍵に upsert し、manual の行は触らない
	it('マスタを取り込み、2回目は変わらず、名前が変われば直し、手で足した会場は触らない', async () => {
		const sheets = createFakeSheets({
			venueMaster: [
				{ code: 'AAA', name: '甲ホール' },
				{ code: 'BBB', name: '乙迎賓館' },
				{ code: 'DDD', name: 'マスタ側の名前' },
			],
		});
		const { request } = createAuthedApp(db, undefined, undefined, sheets);
		await request('/api/venues', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code: 'DDD', name: '手で足した名前' }),
		});

		const first = await request('/api/venues/import', { method: 'POST' });
		expect(first.status).toBe(200);
		await expect(first.json()).resolves.toEqual({
			inserted: 2,
			updated: 0,
			unchanged: 0,
			skipped: 1,
		});

		const second = await request('/api/venues/import', { method: 'POST' });
		await expect(second.json()).resolves.toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 2,
			skipped: 1,
		});

		const renamed = createAuthedApp(
			db,
			undefined,
			undefined,
			createFakeSheets({
				venueMaster: [
					{ code: 'AAA', name: '甲ホール（改名）' },
					{ code: 'BBB', name: '乙迎賓館' },
				],
			}),
		);
		await expect(
			(await renamed.request('/api/venues/import', { method: 'POST' })).json(),
		).resolves.toEqual({
			inserted: 0,
			updated: 1,
			unchanged: 1,
			skipped: 0,
		});

		const venues = (await (await request('/api/venues')).json()) as {
			venues: { code: string; name: string; source: string }[];
		};
		expect(venues.venues).toEqual([
			{
				id: expect.any(Number) as unknown,
				code: 'AAA',
				name: '甲ホール（改名）',
				source: 'master',
				routes: [],
			},
			{
				id: expect.any(Number) as unknown,
				code: 'BBB',
				name: '乙迎賓館',
				source: 'master',
				routes: [],
			},
			{
				id: expect.any(Number) as unknown,
				code: 'DDD',
				name: '手で足した名前',
				source: 'manual',
				routes: [],
			},
		]);
	});

	it('提出シートが読めなければ 502 / 503 をそのまま返す', async () => {
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			createFakeSheets({ fails: 'GOOGLE_UNAUTHORIZED' }),
		);
		const res = await request('/api/venues/import', { method: 'POST' });
		expect(res.status).toBe(503);
	});
});

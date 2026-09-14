import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { createApp } from '../app.js';
import { syncState } from '../db/schema.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 案件は架空の値だけを使う（公開リポジトリ）
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
const app = createApp({ db });

async function post(path: string, body: unknown): Promise<void> {
	const res = await app.request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (res.status !== 201) throw new Error(`下ごしらえに失敗: ${res.status} ${await res.text()}`);
}

async function addProject(projectNo: string, serviceDate: string): Promise<void> {
	await post('/api/projects', {
		projectNo,
		serviceDate,
		venueCode: 'AAA',
		coupleName: '〇〇様△△様',
	});
}

beforeEach(async () => {
	await truncateAll(pool);
	await post('/api/venues', { code: 'AAA', name: '甲ホール' });
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/home', () => {
	it('同期前は対象月度が無く、案件が無ければ months が空', async () => {
		const res = await app.request('/api/home');
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			targetMonth: null,
			lastImportedAt: null,
			lastCronRunAt: null,
			attentionCount: 0,
			months: [],
		});
	});

	// 03-database.md 9.1。カレンダーの月で切らない。8/31 に取り込んだ 9/5 の案件も、8月度の案件も出る。
	// 対象月度より前の案件は出ない
	it('対象月度以降の案件を月度の降順・施行日の昇順で返し、日時は UTC の ISO 8601', async () => {
		await db.insert(syncState).values({
			id: 1,
			lastImportedAt: new Date('2026-09-05T09:42:00Z'),
			lastSeenTargetMonth: '2026-08-01',
			updatedAt: new Date('2026-09-05T09:42:00Z'),
		});
		await addProject('100000002', '2026-09-05');
		await addProject('100000001', '2026-09-05');
		await addProject('100000011', '2026-08-22');
		await addProject('100000099', '2026-07-30');

		const res = await app.request('/api/home');
		expect(res.status).toBe(200);
		const home = (await res.json()) as {
			targetMonth: string;
			lastImportedAt: string;
			months: { month: string; state: string; projects: { projectNo: string }[] }[];
		};
		expect(home.targetMonth).toBe('2026-08');
		expect(home.lastImportedAt).toBe('2026-09-05T09:42:00.000Z');
		expect(home.months.map((m) => [m.month, m.state])).toEqual([
			['2026-09', 'upcoming'],
			['2026-08', 'due'],
		]);
		// 同じ日は案件番号の昇順（要件定義 5.3）
		expect(home.months[0]?.projects.map((p) => p.projectNo)).toEqual(['100000001', '100000002']);
		expect(home.months[1]?.projects.map((p) => p.projectNo)).toEqual(['100000011']);
	});
});

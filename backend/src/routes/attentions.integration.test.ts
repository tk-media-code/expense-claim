import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { attentions } from '../db/schema.js';

// createApp() の実物を test スキーマの DB で叩く。要確認事項を作るエンドポイントは無い（04-api.md 7章）ので、
// 下ごしらえは DB に直接入れる。文面は架空
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
const { request } = createAuthedApp(db);

async function insert(
	kind: 'mail_parse_failed' | 'rows_inserted',
	detail: string,
	occurredAt: string,
	checkedAt: string | null = null,
): Promise<number> {
	const [row] = await db
		.insert(attentions)
		.values({
			kind,
			detail,
			occurredAt: new Date(occurredAt),
			checkedAt: checkedAt ? new Date(checkedAt) : null,
		})
		.$returningId();
	if (!row) throw new Error('attentions の insert が id を返さなかった');
	return row.id;
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/attentions', () => {
	it('新しいものから並べ、?checked=false で未確認だけに絞る', async () => {
		const older = await insert(
			'mail_parse_failed',
			'件名「…」のメールを取り込めませんでした',
			'2026-09-01T00:00:00Z',
		);
		const checked = await insert(
			'rows_inserted',
			'提出時に 3 行を挿入しました',
			'2026-09-02T00:00:00Z',
			'2026-09-03T00:00:00Z',
		);
		const newest = await insert(
			'mail_parse_failed',
			'件名「…」のメールを取り込めませんでした',
			'2026-09-05T00:00:00Z',
		);

		const all = (await (await request('/api/attentions')).json()) as {
			attentions: { id: number }[];
		};
		expect(all.attentions.map((a) => a.id)).toEqual([newest, checked, older]);

		const unchecked = (await (await request('/api/attentions?checked=false')).json()) as {
			attentions: { id: number; checkedAt: string | null }[];
		};
		expect(unchecked.attentions.map((a) => a.id)).toEqual([newest, older]);
		expect(unchecked.attentions[0]).toMatchObject({ kind: 'mail_parse_failed', checkedAt: null });
	});
});

describe('POST /api/attentions/:id/check', () => {
	// F-34。確認済みにする。未確認へ戻す操作は無い
	it('確認済みにし、ホームの件数から消える', async () => {
		const id = await insert('rows_inserted', '提出時に 3 行を挿入しました', '2026-09-02T00:00:00Z');
		expect(
			((await (await request('/api/home')).json()) as { attentionCount: number }).attentionCount,
		).toBe(1);

		const res = await request(`/api/attentions/${id}/check`, { method: 'POST' });
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			id,
			checkedAt: expect.any(String) as unknown,
		});
		expect(
			((await (await request('/api/home')).json()) as { attentionCount: number }).attentionCount,
		).toBe(0);
	});

	// 06-error-handling.md 5.3。確認済みの行は消さず、もう一度押しても日時は動かない
	it('既に確認済みなら日時を変えずに返す', async () => {
		const id = await insert(
			'rows_inserted',
			'提出時に 3 行を挿入しました',
			'2026-09-02T00:00:00Z',
			'2026-09-03T00:00:00Z',
		);
		const res = await request(`/api/attentions/${id}/check`, { method: 'POST' });
		await expect(res.json()).resolves.toMatchObject({ checkedAt: '2026-09-03T00:00:00.000Z' });
	});

	it('無い id なら 404', async () => {
		expect((await request('/api/attentions/9999/check', { method: 'POST' })).status).toBe(404);
	});
});

import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp, createFakeGmail } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { importedMails } from '../db/schema.js';
import type { FetchedMail } from '../integrations/gmail/client.js';

// POST /api/sync の取り込み（04-api.md 4.3 手順4〜5 / 05-integration.md 4章）を、偽物の Gmail で確かめる。
// メールの中身は架空（公開リポジトリ）
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

function requestMail(
	id: string,
	date: string,
	projectNo: string,
	venue = 'AAA',
	couple = '〇〇様 △△様',
): FetchedMail {
	const [y, m, d] = date.split('-').map(Number);
	const slashed = `${y}/${m}/${d}`;
	return {
		id,
		threadId: `t-${id}`,
		internalDate: new Date('2026-08-31T01:00:00Z'),
		subject: `${slashed}案件詳細です。`,
		plainBody: [
			slashed,
			`${venue}会場`,
			venue,
			couple,
			'',
			`施行日 ${slashed}`,
			`案件番号：${projectNo}`,
		].join('\n'),
		htmlText: '',
	};
}

const noRequest: FetchedMail = {
	id: 'nr-1',
	threadId: null,
	internalDate: new Date('2026-08-31T01:00:00Z'),
	subject: '【9月5日(土) 依頼無しのご連絡】',
	plainBody: '本日は依頼がありません',
	htmlText: '',
};

async function json(request: ReturnType<typeof createAuthedApp>['request'], path: string) {
	return (await (await request(path)).json()) as Record<string, unknown>;
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('POST /api/sync（取り込み）', () => {
	// F-03〜F-08。案件詳細は案件になり、依頼無しは処理済みとして残るが案件にならない
	it('案件詳細メールを案件にし、依頼無しは案件にせず、last_imported_at を更新する', async () => {
		const gmail = createFakeGmail({
			mails: [
				requestMail('m1', '2026-09-05', '100000001'),
				requestMail('m2', '2026-09-05', '100000002', 'BBB', '□□様 ◇◇様'),
				noRequest,
			],
		});
		const { request } = createAuthedApp(db, undefined, undefined, undefined, gmail);
		const res = await request('/api/sync', { method: 'POST' });
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ importedCount: 2, warnings: [] });
		// 初回は after: を付けない
		expect(gmail.listedAfter).toEqual([null]);

		const home = await json(request, '/api/home');
		expect(home.lastImportedAt).toEqual(expect.any(String));
		const months = home.months as {
			projects: { projectNo: string; venueName: string; coupleName: string }[];
		}[];
		expect(months[0]?.projects.map((p) => [p.projectNo, p.venueName, p.coupleName])).toEqual([
			['100000001', 'AAA会場', '〇〇様△△様'],
			['100000002', 'BBB会場', '□□様◇◇様'],
		]);
		await expect(db.select().from(importedMails)).resolves.toHaveLength(3);
	});

	// F-08。同じメールを2度取り込んでも案件は増えない。2回目は前回の取り込み日の1日前から引く
	it('2回目は同じメールを飛ばし、案件は増えず、after: に前回の1日前を付ける', async () => {
		const gmail = createFakeGmail({ mails: [requestMail('m1', '2026-09-05', '100000001')] });
		const { request } = createAuthedApp(db, undefined, undefined, undefined, gmail);
		await request('/api/sync', { method: 'POST' });
		const second = await request('/api/sync', { method: 'POST' });
		await expect(second.json()).resolves.toMatchObject({ importedCount: 0, warnings: [] });
		expect(gmail.listedAfter[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const home = await json(request, '/api/home');
		expect((home.months as { projects: unknown[] }[])[0]?.projects).toHaveLength(1);
	});

	// 要件定義 6.2。先に手で足した案件が、後からメールで取り込まれても増えない
	it('同じ案件番号の案件が既にあれば増やさず、そのメールを取り込み元として紐付ける', async () => {
		const gmail = createFakeGmail({ mails: [requestMail('m1', '2026-09-05', '100000001')] });
		const { request } = createAuthedApp(db, undefined, undefined, undefined, gmail);
		await request('/api/venues', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code: 'AAA', name: '甲ホール' }),
		});
		await request('/api/projects', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				projectNo: '100000001',
				serviceDate: '2026-09-05',
				venueCode: 'AAA',
				coupleName: '〇〇様△△様',
			}),
		});
		const res = await request('/api/sync', { method: 'POST' });
		await expect(res.json()).resolves.toMatchObject({ importedCount: 0 });
		const home = await json(request, '/api/home');
		const projects = (home.months as { projects: { venueName: string }[] }[])[0]?.projects ?? [];
		expect(projects).toHaveLength(1);
		// 手で足した案件のまま（会場名も source も変わらない）
		expect(projects[0]?.venueName).toBe('甲ホール');
		await expect(db.select().from(importedMails)).resolves.toHaveLength(1);
	});

	// F-07。裏取りが通らなければ案件を作らず、要確認事項に残す。次回は読み直さない
	it('解析に失敗したメールは案件にせず、要確認事項に残し、次回は飛ばす', async () => {
		const broken = requestMail('m1', '2026-09-05', '100000001');
		broken.plainBody = broken.plainBody.replace('〇〇様 △△様', '〇〇様');
		const gmail = createFakeGmail({ mails: [broken] });
		const { request } = createAuthedApp(db, undefined, undefined, undefined, gmail);
		await expect((await request('/api/sync', { method: 'POST' })).json()).resolves.toMatchObject({
			importedCount: 0,
			warnings: [],
		});

		const attentions = (await json(request, '/api/attentions?checked=false')).attentions as {
			kind: string;
			detail: string;
		}[];
		expect(attentions).toHaveLength(1);
		expect(attentions[0]?.kind).toBe('mail_parse_failed');
		expect(attentions[0]?.detail).toContain('2026/9/5案件詳細です。');
		expect(attentions[0]?.detail).toContain('ご両家名');
		expect(attentions[0]?.detail).not.toContain('案件番号：');

		await request('/api/sync', { method: 'POST' });
		expect(
			((await json(request, '/api/attentions?checked=false')).attentions as unknown[]).length,
		).toBe(1);
	});

	// 04-api.md 4.3 / 06-error-handling.md 6.4。Gmail が読めなくても 200 で、last_imported_at は動かない
	it('Gmail が読めなければ 200 で warnings に載せ、last_imported_at を更新しない', async () => {
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			undefined,
			createFakeGmail({ fails: 'unauthorized' }),
		);
		const res = await request('/api/sync', { method: 'POST' });
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			targetMonth: '2026-08',
			importedCount: 0,
			warnings: [{ code: 'GOOGLE_UNAUTHORIZED' }],
		});
		const home = await json(request, '/api/home');
		expect(home.lastImportedAt).toBeNull();
		// 月度の検知は済んでいる（片方の失敗で全体を落とさない）
		expect(home.targetMonth).toBe('2026-08');
	});

	// 1回の実行で複数の月度の案件ができる（要件定義 9.2）。取り込みは月度で絞らない
	it('月をまたぐ案件を1回で取り込む', async () => {
		const gmail = createFakeGmail({
			mails: [
				requestMail('m1', '2026-10-31', '100000001'),
				requestMail('m2', '2026-11-01', '100000002'),
			],
		});
		const { request } = createAuthedApp(db, undefined, undefined, undefined, gmail);
		await expect((await request('/api/sync', { method: 'POST' })).json()).resolves.toMatchObject({
			importedCount: 2,
		});
		const home = await json(request, '/api/home');
		expect((home.months as { month: string }[]).map((m) => m.month)).toEqual([
			'2026-11',
			'2026-10',
		]);
	});
});

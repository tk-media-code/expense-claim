import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp, createFakeDrive, createFakeSheets } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { submissions } from '../db/schema.js';

// 提出の2段構え（04-api.md 6章）を、偽物の提出シートと createApp() の実物で確かめる。
// 要件定義 5.6 の架空の例（2026年9月分・案件3件）を DB に組み、7行と領収書2本が出ることを見る
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

type Request = ReturnType<typeof createAuthedApp>['request'];

async function post(request: Request, path: string, body?: unknown): Promise<Response> {
	return request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function id(pending: Promise<Response>): Promise<number> {
	const res = await pending;
	if (res.status !== 201) throw new Error(`下ごしらえに失敗: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { id: number }).id;
}

/** 要件定義 5.6 の3案件。会場 AAA は乙駅乗換1本、BBB は丁駅乗換と戊駅直通の2本 */
async function seed(request: Request) {
	const aaa = await id(post(request, '/api/venues', { code: 'AAA', name: '甲ホール' }));
	const bbb = await id(post(request, '/api/venues', { code: 'BBB', name: '乙迎賓館' }));
	const st = async (name: string) => id(post(request, '/api/stations', { name }));
	const [x, xOtsu, yOtsu, yHei, xTei, yTei, yBo, zBo] = await Promise.all(
		['X鉄甲駅', 'X鉄乙駅', 'Y鉄乙駅', 'Y鉄丙駅', 'X鉄丁駅', 'Y鉄丁駅', 'Y鉄戊駅', 'Z鉄戊駅'].map(
			st,
		),
	);
	const seg = (from: number, to: number, fare: number) =>
		id(post(request, '/api/segments', { fromStationId: from, toStationId: to, oneWayFare: fare }));
	const viaOtsu = await id(
		post(request, '/api/routes', {
			venueId: aaa,
			name: '乙駅乗換',
			segmentIds: [await seg(x!, xOtsu!, 320), await seg(yOtsu!, yHei!, 210)],
		}),
	);
	const viaTei = await id(
		post(request, '/api/routes', {
			venueId: bbb,
			name: '丁駅乗換',
			segmentIds: [await seg(x!, xTei!, 380), await seg(yTei!, yBo!, 210)],
		}),
	);
	const direct = await id(
		post(request, '/api/routes', {
			venueId: bbb,
			name: '戊駅直通',
			segmentIds: [await seg(x!, zBo!, 520)],
		}),
	);
	const project = (no: string, date: string, venue: string, couple: string) =>
		id(
			post(request, '/api/projects', {
				projectNo: no,
				serviceDate: date,
				venueCode: venue,
				coupleName: couple,
			}),
		);
	const a = await project('100000001', '2026-09-05', 'AAA', '〇〇様△△様');
	const b = await project('100000002', '2026-09-05', 'BBB', '□□様◇◇様');
	const c = await project('100000003', '2026-09-12', 'AAA', '××様＋＋様');
	// 10月の案件（対象月度の外）も1件。混ざらないことを見る
	await project('100000004', '2026-10-03', 'AAA', '◎◎様☆☆様');
	const record = (p: number, body: unknown) =>
		request(`/api/projects/${p}/expense-record`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
	await record(a, { tripType: 'round', outboundRouteId: viaOtsu });
	await record(b, { tripType: 'one_way', outboundRouteId: viaTei, returnRouteId: direct });
	await record(c, { tripType: 'round', outboundRouteId: viaOtsu });
	// 案件 A に乗車2件
	for (const amount of ['1800', '1400']) {
		const form = new FormData();
		form.append('amount', amount);
		form.append('receipt', new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), 'r.jpg');
		await request(`/api/projects/${a}/taxi-rides`, { method: 'POST', body: form });
	}
	return { a, b, c };
}

const master = [
	{ code: 'AAA', name: '甲ホール' },
	{ code: 'BBB', name: '乙迎賓館' },
];

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('POST /api/submissions/preview（04-api.md 5.4）', () => {
	it('要件定義 5.6 の7行と領収書欄を、書き込む形のまま返す', async () => {
		const sheets = createFakeSheets({ targetMonth: '2026-09', venueMaster: master });
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		const { a, b, c } = await seed(request);

		const res = await post(request, '/api/submissions/preview');
		expect(res.status).toBe(200);
		const preview = (await res.json()) as Record<string, unknown>;
		expect(preview).toMatchObject({
			targetMonth: '2026-09',
			lastSubmittedAt: null,
			attentionCount: 0,
			writableRows: 25,
			rowsToInsert: 0,
			warnings: [],
			receiptCell:
				'(9/5)\nhttps://drive.google.com/file/d/file-1/view\nhttps://drive.google.com/file/d/file-2/view',
		});
		const rows = preview.rows as {
			no: number;
			projectId: number;
			cells: Record<string, unknown>;
		}[];
		expect(rows.map((r) => [r.no, r.projectId])).toEqual([
			[1, a],
			[2, a],
			[3, b],
			[4, b],
			[5, b],
			[6, c],
			[7, c],
		]);
		expect(rows[0]?.cells).toEqual({
			A: '2026/9/5',
			B: 'AAA',
			C: '婚礼案件',
			D: '〇〇様△△様',
			E: 'X鉄甲駅',
			F: 'X鉄乙駅',
			G: '往復',
			H: 640,
			I: 3200,
		});
		expect(rows[4]?.cells).toEqual({
			A: null,
			B: null,
			C: null,
			D: null,
			E: 'Z鉄戊駅',
			F: 'X鉄甲駅',
			G: '片道',
			H: 520,
			I: null,
		});
		// J〜L は応答に出さない。書かない欄を出すと書くように見える
		expect(Object.keys(rows[0]?.cells ?? {})).toEqual([
			'A',
			'B',
			'C',
			'D',
			'E',
			'F',
			'G',
			'H',
			'I',
		]);
		// 書かない（プレビュー）
		expect(sheets.written).toEqual([]);
		await expect(db.select().from(submissions)).resolves.toEqual([]);
	});

	// 要件定義 5.5 の「中止しない」2件は warnings に載る。プレビューは要確認事項に積まない（06-error-handling.md 3.2）
	it('記録の無い案件とマスタに無い会場コードは warnings に載り、要確認事項には積まない', async () => {
		const sheets = createFakeSheets({
			targetMonth: '2026-09',
			venueMaster: [{ code: 'AAA', name: '甲ホール' }],
		});
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		const { b, c } = await seed(request);
		await request(`/api/projects/${c}`, { method: 'DELETE' });
		await post(request, '/api/projects', {
			projectNo: '100000005',
			serviceDate: '2026-09-20',
			venueCode: 'AAA',
			coupleName: '記録無し様',
		});

		const preview = (await (await post(request, '/api/submissions/preview')).json()) as {
			warnings: { code: string; projectId: number }[];
			rows: unknown[];
		};
		expect(preview.warnings.map((w) => w.code)).toEqual([
			'VENUE_CODE_UNKNOWN',
			'NO_EXPENSE_RECORD',
		]);
		expect(preview.warnings[0]?.projectId).toBe(b);
		expect(preview.rows).toHaveLength(5);
		const attentions = (await (await request('/api/attentions?checked=false')).json()) as {
			attentions: unknown[];
		};
		expect(attentions.attentions).toEqual([]);
	});

	// 要件定義 5.3。行が足りなければ挿入する行数を先に知らせる
	it('書ける行数を超える分を rowsToInsert として返す', async () => {
		const sheets = createFakeSheets({
			targetMonth: '2026-09',
			venueMaster: master,
			structure: { writableRows: 5, lastBodyRow: 12 },
		});
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		await seed(request);
		await expect((await post(request, '/api/submissions/preview')).json()).resolves.toMatchObject({
			writableRows: 5,
			rowsToInsert: 2,
		});
	});

	// 04-api.md 5.4。中止するときは 200 を返さない。読めなかったことは要確認事項に残る（様式の変更を除く）
	it.each([
		['認可切れ', 'GOOGLE_UNAUTHORIZED', 503, true],
		['共有停止', 'SHEET_UNREACHABLE', 502, true],
		['A1 が読めない', 'TARGET_MONTH_UNREADABLE', 502, true],
		['様式が変わった', 'SHEET_FORMAT_CHANGED', 502, false],
	] as const)('%s なら %s を返す', async (_label, code, status, recorded) => {
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			createFakeSheets({ fails: code }),
		);
		const res = await post(request, '/api/submissions/preview');
		expect(res.status).toBe(status);
		await expect(res.json()).resolves.toMatchObject({ error: { code } });
		const attentions = (await (await request('/api/attentions?checked=false')).json()) as {
			attentions: { kind: string }[];
		};
		expect(attentions.attentions.map((a) => a.kind)).toEqual(recorded ? ['sheet_unreachable'] : []);
	});
});

describe('POST /api/submissions（04-api.md 6章）', () => {
	it('手順をやり直して矩形を書き、submissions に1行足し、書いた行数を返す', async () => {
		const sheets = createFakeSheets({ targetMonth: '2026-09', venueMaster: master });
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		await seed(request);

		const res = await post(request, '/api/submissions', { targetMonth: '2026-09' });
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ writtenRows: 7, rowsInserted: 0, warnings: [] });
		expect(sheets.inserted).toEqual([]);
		expect(sheets.written).toHaveLength(1);
		expect(sheets.written[0]?.rows).toHaveLength(7);
		expect(sheets.written[0]?.receiptCell).toContain('(9/5)');
		await expect(db.select().from(submissions)).resolves.toHaveLength(1);
		// 提出済みが preview とホームに出る（F-30 / 02-screens.md 4.2）
		await expect((await post(request, '/api/submissions/preview')).json()).resolves.toMatchObject({
			lastSubmittedAt: expect.any(String) as unknown,
		});
		const home = (await (await request('/api/home')).json()) as {
			months: { month: string; state: string; submittedAt: string | null }[];
		};
		expect(home.months.find((m) => m.month === '2026-09')).toMatchObject({
			state: 'submitted',
			submittedAt: expect.any(String) as unknown,
		});
	});

	// 04-api.md 6.2。確認した画面と違う月度のシートへ書かない
	it('送られた targetMonth が A1 と違えば 409 で、何も書かない', async () => {
		const sheets = createFakeSheets({ targetMonth: '2026-09', venueMaster: master });
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		await seed(request);
		const res = await post(request, '/api/submissions', { targetMonth: '2026-08' });
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toMatchObject({ error: { code: 'TARGET_MONTH_CHANGED' } });
		expect(sheets.written).toEqual([]);
		await expect(db.select().from(submissions)).resolves.toEqual([]);
	});

	// 要件定義 5.2 手順5 / 05-integration.md 8.3。足りないぶんを挿入し、要確認事項に残し、構造を読み直す
	it('行が足りなければ挿入してから書き、rows_inserted を要確認事項に残す', async () => {
		const sheets = createFakeSheets({
			targetMonth: '2026-09',
			venueMaster: master,
			structure: { writableRows: 5, lastBodyRow: 12 },
		});
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		await seed(request);
		const res = await post(request, '/api/submissions', { targetMonth: '2026-09' });
		await expect(res.json()).resolves.toMatchObject({ writtenRows: 7, rowsInserted: 2 });
		expect(sheets.inserted).toEqual([2]);
		expect(sheets.written).toHaveLength(1);
		const attentions = (await (await request('/api/attentions?checked=false')).json()) as {
			attentions: { kind: string; detail: string }[];
		};
		expect(attentions.attentions.map((a) => a.kind)).toEqual(['rows_inserted']);
		expect(attentions.attentions[0]?.detail).toContain('2行を挿入');
	});

	// 06-error-handling.md 3.2。実行では venue_code_unknown を積む
	it('マスタに無い会場コードは書いたうえで要確認事項に残す', async () => {
		const sheets = createFakeSheets({
			targetMonth: '2026-09',
			venueMaster: [{ code: 'AAA', name: '甲ホール' }],
		});
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		await seed(request);
		const res = await post(request, '/api/submissions', { targetMonth: '2026-09' });
		await expect(res.json()).resolves.toMatchObject({
			writtenRows: 7,
			warnings: [{ code: 'VENUE_CODE_UNKNOWN' }],
		});
		const attentions = (await (await request('/api/attentions?checked=false')).json()) as {
			attentions: { kind: string; detail: string }[];
		};
		expect(attentions.attentions.map((a) => a.kind)).toEqual(['venue_code_unknown']);
		expect(attentions.attentions[0]?.detail).toContain('BBB');
		expect(attentions.attentions[0]?.detail).toContain('□□様◇◇様');
	});

	// F-29。何度でも実行でき、結果が同じ
	it('2回実行すると submissions が2行になり、シートは2回とも同じ矩形', async () => {
		const sheets = createFakeSheets({ targetMonth: '2026-09', venueMaster: master });
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			sheets,
			undefined,
			createFakeDrive(),
		);
		await seed(request);
		await post(request, '/api/submissions', { targetMonth: '2026-09' });
		await post(request, '/api/submissions', { targetMonth: '2026-09' });
		await expect(db.select().from(submissions)).resolves.toHaveLength(2);
		expect(sheets.written[0]?.rows).toEqual(sheets.written[1]?.rows);
	});

	it('対象月度の形が違えば 422', async () => {
		const { request } = createAuthedApp(db);
		expect((await post(request, '/api/submissions', { targetMonth: '2026-09-01' })).status).toBe(
			422,
		);
	});
});

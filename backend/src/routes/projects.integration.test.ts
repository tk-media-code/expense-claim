import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { errorCatalog } from '../domain/app-error.js';

// createApp() の実物を test スキーマの DB で叩く（07-development.md 4章）。
// 案件番号・会場・ご両家名は架空の値だけを使う（公開リポジトリ）。要件定義 5.6 の例に合わせる
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

const input = {
	projectNo: '100000001',
	serviceDate: '2026-09-05',
	venueCode: 'AAA',
	coupleName: '〇〇様△△様',
};

beforeEach(async () => {
	await truncateAll(pool);
	await created(json('POST', '/api/venues', { code: 'AAA', name: '甲ホール' }));
});

afterAll(async () => {
	await pool.end();
});

describe('POST /api/projects', () => {
	// F-10。手で足す案件は manual で、会場名は会場コードから連動し、月度は施行日から導出する
	it('201 で会場名と月度を補った案件を返す', async () => {
		const res = await json('POST', '/api/projects', input);
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toEqual({
			id: expect.any(Number) as unknown,
			projectNo: '100000001',
			serviceDate: '2026-09-05',
			month: '2026-09',
			venueCode: 'AAA',
			venueName: '甲ホール',
			coupleName: '〇〇様△△様',
			source: 'manual',
		});
	});

	// 04-api.md 7章。source を受け取らない
	it('source を送っても manual になる', async () => {
		const res = await json('POST', '/api/projects', { ...input, source: 'mail' });
		await expect(res.json()).resolves.toMatchObject({ source: 'manual' });
	});

	// F-08。先に手で足した案件が後からメールで取り込まれても増えない、の逆も同じ
	it('同じ案件番号を2回登録すると 409 を返す', async () => {
		await created(json('POST', '/api/projects', input));
		const res = await json('POST', '/api/projects', { ...input, coupleName: '別の名前' });
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: {
				code: 'PROJECT_NO_DUPLICATED',
				message: errorCatalog.PROJECT_NO_DUPLICATED.message,
			},
		});
	});

	it.each([
		['案件番号が無い', { ...input, projectNo: undefined }, '案件番号を入れてください'],
		['案件番号が空白', { ...input, projectNo: ' ' }, '案件番号を入れてください'],
		['施行日が無い', { ...input, serviceDate: undefined }, '施行日を入れてください'],
		[
			'施行日が 0 埋め無し',
			{ ...input, serviceDate: '2026-9-5' },
			'施行日は YYYY-MM-DD の形で入れてください',
		],
		[
			'施行日が暦に無い',
			{ ...input, serviceDate: '2026-02-30' },
			'施行日は YYYY-MM-DD の形で入れてください',
		],
		[
			'施行日に時刻',
			{ ...input, serviceDate: '2026-09-05T00:00:00Z' },
			'施行日は YYYY-MM-DD の形で入れてください',
		],
		['会場が無い', { ...input, venueCode: undefined }, '会場を選んでください'],
		['ご両家名が無い', { ...input, coupleName: undefined }, 'ご両家名を入れてください'],
		['会場が一覧に無い', { ...input, venueCode: 'ZZZ' }, '会場が見つかりません'],
	])('%s なら 422 で項目の文面を返す', async (_label, body, message) => {
		const res = await json('POST', '/api/projects', body);
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({ error: { code: 'INVALID_VALUE', message } });
	});
});

describe('GET /api/projects/:id', () => {
	it('登録した案件を返す', async () => {
		const project = await created(json('POST', '/api/projects', input));
		const res = await app.request(`/api/projects/${project.id}`);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ id: project.id, projectNo: '100000001' });
	});

	it.each([
		['無い id', '9999'],
		['整数でない id', 'abc'],
	])('%s なら 404 を返す', async (_label, id) => {
		const res = await app.request(`/api/projects/${id}`);
		expect(res.status).toBe(404);
	});
});

describe('PATCH /api/projects/:id', () => {
	// F-11 / 04-api.md 4.4。施行日を直すと所属月度が変わる
	it('施行日を直すと月度が変わり、他の項目はそのまま', async () => {
		const project = await created(json('POST', '/api/projects', input));
		const res = await json('PATCH', `/api/projects/${project.id}`, { serviceDate: '2026-10-03' });
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			serviceDate: '2026-10-03',
			month: '2026-10',
			coupleName: '〇〇様△△様',
		});
	});

	it('会場コードを直すと会場名も連動する', async () => {
		await created(json('POST', '/api/venues', { code: 'BBB', name: '乙迎賓館' }));
		const project = await created(json('POST', '/api/projects', input));
		const res = await json('PATCH', `/api/projects/${project.id}`, { venueCode: 'BBB' });
		await expect(res.json()).resolves.toMatchObject({ venueCode: 'BBB', venueName: '乙迎賓館' });
	});

	it('他の案件と同じ案件番号にすると 409、自分と同じなら 200', async () => {
		const a = await created(json('POST', '/api/projects', input));
		await created(json('POST', '/api/projects', { ...input, projectNo: '100000002' }));
		expect((await json('PATCH', `/api/projects/${a.id}`, { projectNo: '100000002' })).status).toBe(
			409,
		);
		expect((await json('PATCH', `/api/projects/${a.id}`, { projectNo: '100000001' })).status).toBe(
			200,
		);
	});

	it('空の本文なら何も変えずに 200 を返す', async () => {
		const project = await created(json('POST', '/api/projects', input));
		const res = await json('PATCH', `/api/projects/${project.id}`, {});
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ projectNo: '100000001' });
	});

	it('無い id なら 404 を返す', async () => {
		expect((await json('PATCH', '/api/projects/9999', { coupleName: 'a' })).status).toBe(404);
	});
});

describe('DELETE /api/projects/:id', () => {
	it('204 で本文を返さず、消える', async () => {
		const project = await created(json('POST', '/api/projects', input));
		const res = await app.request(`/api/projects/${project.id}`, { method: 'DELETE' });
		expect(res.status).toBe(204);
		expect(await res.text()).toBe('');
		expect((await app.request(`/api/projects/${project.id}`)).status).toBe(404);
	});

	it('無い id なら 404 を返す', async () => {
		expect((await app.request('/api/projects/9999', { method: 'DELETE' })).status).toBe(404);
	});
});

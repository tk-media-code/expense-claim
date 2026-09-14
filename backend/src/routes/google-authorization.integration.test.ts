import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp, createFakeGoogleAuth, sessionCookie } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';

// Google API の認可（04-api.md 4.2 / 05-integration.md 3.2 ②）を createApp() の実物で確かめる。
// Google は偽物で差し替える。ログイン（/api/auth）とは別の流れである
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

function cookieOf(res: Response, name: string): string | null {
	const header = res.headers.get('set-cookie');
	if (!header) return null;
	const found = header.split(/,(?=[^;]+=)/).find((part) => part.trim().startsWith(`${name}=`));
	return found ? (found.trim().split(';')[0] ?? null) : null;
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('GET /api/google/authorization', () => {
	// 4.2。返すのは有無・スコープ・認可日時・足りないスコープだけ。トークンは返さない
	it('未認可なら authorized が偽で、4つとも足りない', async () => {
		const { request } = createAuthedApp(db);
		const res = await request('/api/google/authorization');
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			authorized: false,
			scopes: [],
			authorizedAt: null,
			missingScopes: ['gmail.readonly', 'gmail.send', 'drive.file', 'spreadsheets'],
		});
	});

	// 03-database.md 5.3。gmail.send が後から足されたので、古いトークンだと足りない
	it('認可済みならスコープと認可日時を返し、足りないものを添える', async () => {
		const { request } = createAuthedApp(
			db,
			undefined,
			createFakeGoogleAuth({
				scopes: ['gmail.readonly', 'drive.file', 'spreadsheets'],
				authorizedAt: new Date('2026-09-01T02:00:00Z'),
			}),
		);
		await expect((await request('/api/google/authorization')).json()).resolves.toEqual({
			authorized: true,
			scopes: ['gmail.readonly', 'drive.file', 'spreadsheets'],
			authorizedAt: '2026-09-01T02:00:00.000Z',
			missingScopes: ['gmail.send'],
		});
	});

	it('未ログインなら 401', async () => {
		const { app } = createAuthedApp(db);
		expect((await app.request('/api/google/authorization')).status).toBe(401);
	});
});

describe('認可のフロー', () => {
	it('start は同意画面へ 302 し、照合用の Cookie を置く', async () => {
		const { request } = createAuthedApp(db);
		const res = await request('/api/google/authorization/start');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toContain('accounts.example.test');
		expect(cookieOf(res, 'authorization')).not.toBeNull();
	});

	it('callback が通れば保存して設定画面へ 302 し、以後は認可済みになる', async () => {
		const google = createFakeGoogleAuth();
		const { request } = createAuthedApp(db, undefined, google);
		const start = await request('/api/google/authorization/start');
		const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
		const cookie = cookieOf(start, 'authorization') ?? '';

		// 照合用の Cookie とセッションの Cookie を両方載せる
		const res = await request(`/api/google/authorization/callback?code=abc&state=${state}`, {
			headers: { cookie: `${cookie}; ${await sessionCookie()}` },
		});
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/settings');
		expect(google.completed).toEqual([
			{ code: 'abc', codeVerifier: expect.any(String) as unknown },
		]);
		await expect((await request('/api/google/authorization')).json()).resolves.toMatchObject({
			authorized: true,
			missingScopes: [],
		});
	});

	// 05-integration.md 3.4。state の素の照合
	it('state が違えば保存せず、設定画面へ理由つきで戻す', async () => {
		const google = createFakeGoogleAuth();
		const { request } = createAuthedApp(db, undefined, google);
		const start = await request('/api/google/authorization/start');
		const cookie = cookieOf(start, 'authorization') ?? '';
		const res = await request('/api/google/authorization/callback?code=abc&state=forged', {
			headers: { cookie: `${cookie}; ${await sessionCookie()}` },
		});
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toContain('/settings?error=');
		expect(google.completed).toEqual([]);
	});
});

describe('GET /api/settings（04-api.md 4.10）', () => {
	it('名前と対象月度と認可状態だけを返し、ID は返さない', async () => {
		const { request } = createAuthedApp(db);
		const res = await request('/api/settings');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({
			spreadsheetName: null,
			sheetName: '9999 テスト太郎',
			targetMonth: null,
			google: {
				authorized: false,
				missingScopes: ['gmail.readonly', 'gmail.send', 'drive.file', 'spreadsheets'],
			},
		});
		expect(JSON.stringify(body)).not.toMatch(/spreadsheetId|folderId/i);
	});
});

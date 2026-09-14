import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
	createAuthedApp,
	createFakeLoginProvider,
	sessionCookie,
	TEST_CONFIG,
} from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { errorCatalog } from '../domain/app-error.js';
import { SESSION_TTL_SECONDS } from '../domain/session.js';
import { verifySessionToken } from './session-cookie.js';

// 認証（04-api.md 4.1 / 05-integration.md 3章）を createApp() の実物で確かめる。
// Google は偽物の LoginProvider で、メールアドレスは架空の値（公開リポジトリ）
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

function cookieOf(res: Response, name: string): string | null {
	const header = res.headers.get('set-cookie');
	if (!header) return null;
	const found = header.split(/,(?=[^;]+=)/).find((part) => part.trim().startsWith(`${name}=`));
	return found ? found.trim() : null;
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('/api/* の認証（NF-06）', () => {
	it('Cookie が無ければ 401 を返す', async () => {
		const { app } = createAuthedApp(db);
		const res = await app.request('/api/home');
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'UNAUTHENTICATED', message: errorCatalog.UNAUTHENTICATED.message },
		});
	});

	it('署名が合わない Cookie は 401', async () => {
		const { app } = createAuthedApp(db);
		const res = await app.request('/api/home', { headers: { cookie: 'session=abc.def' } });
		expect(res.status).toBe(401);
	});

	it('90日を過ぎた Cookie は 401', async () => {
		const { app } = createAuthedApp(db);
		const iat = Math.floor(Date.now() / 1000) - SESSION_TTL_SECONDS - 1;
		const res = await app.request('/api/home', { headers: { cookie: await sessionCookie(iat) } });
		expect(res.status).toBe(401);
	});

	// 01-architecture.md 3.7。使うたび延びる。応答で iat を今にした Cookie が発行し直される
	it('通ったリクエストは Cookie を発行し直す', async () => {
		const { app } = createAuthedApp(db);
		const iat = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
		const res = await app.request('/api/home', { headers: { cookie: await sessionCookie(iat) } });
		expect(res.status).toBe(200);
		const renewed = cookieOf(res, 'session');
		expect(renewed).toContain('HttpOnly');
		expect(renewed).toContain('SameSite=Lax');
		const token = renewed?.split(';')[0]?.slice('session='.length) ?? '';
		const session = await verifySessionToken(TEST_CONFIG.sessionSecret, token);
		expect(session?.iat).toBeGreaterThan(iat);
	});

	// 04-api.md 2.2。Origin が自分のホストでなければ 403。付いていなければ通す
	it('状態を変えるメソッドで Origin が違えば 403、同じなら通る', async () => {
		const { request } = createAuthedApp(db);
		const body = JSON.stringify({ name: 'X鉄甲駅' });
		const headers = { 'content-type': 'application/json', host: 'app.example.test' };
		expect(
			(
				await request('/api/stations', {
					method: 'POST',
					body,
					headers: { ...headers, origin: 'https://evil.example' },
				})
			).status,
		).toBe(403);
		expect(
			(
				await request('/api/stations', {
					method: 'POST',
					body,
					headers: { ...headers, origin: 'https://app.example.test' },
				})
			).status,
		).toBe(201);
	});
});

describe('GET /api/auth/session', () => {
	it('ログイン済みなら 200、未ログインなら 401', async () => {
		const { app, request } = createAuthedApp(db);
		await expect((await request('/api/auth/session')).json()).resolves.toEqual({
			authenticated: true,
		});
		expect((await app.request('/api/auth/session')).status).toBe(401);
	});
});

describe('ログイン（05-integration.md 3.2 ①）', () => {
	it('GET /api/auth/login は state・nonce・PKCE を載せて Google へ 302 し、照合用の Cookie を置く', async () => {
		const provider = createFakeLoginProvider();
		const { app } = createAuthedApp(db, provider);
		const res = await app.request('/api/auth/login');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toContain('accounts.example.test');
		expect(provider.lastParams?.state).toMatch(/^[A-Za-z0-9_-]{20,}$/);
		expect(provider.lastParams?.nonce).toMatch(/^[A-Za-z0-9_-]{20,}$/);
		expect(provider.lastParams?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{40,}$/);
		expect(cookieOf(res, 'login')).toContain('HttpOnly');
	});

	async function startLogin(provider = createFakeLoginProvider()) {
		const { app } = createAuthedApp(db, provider);
		const start = await app.request('/api/auth/login');
		const login = cookieOf(start, 'login')?.split(';')[0] ?? '';
		return { app, provider, login, state: provider.lastParams?.state ?? '' };
	}

	// F-01。許可アドレスなら Cookie を発行して / へ
	it('コールバックが通ればセッション Cookie を発行し、/ へ 302 する', async () => {
		const { app, login, state } = await startLogin();
		const res = await app.request(`/api/auth/callback?code=abc&state=${state}`, {
			headers: { cookie: login },
		});
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/');
		const session = cookieOf(res, 'session');
		expect(session).toContain('HttpOnly');
		const token = session?.split(';')[0]?.slice('session='.length) ?? '';
		await expect(verifySessionToken(TEST_CONFIG.sessionSecret, token)).resolves.toMatchObject({
			sub: 'sub-1',
		});
	});

	// N-03 / 04-api.md 4.1「不一致は 403」。ブラウザには JSON でなくログイン画面の文面で見せる
	it('許可アドレス以外はセッションを発行せず、ログイン画面へ拒否の理由つきで戻す', async () => {
		const { app, login, state } = await startLogin(
			createFakeLoginProvider({
				sub: 'sub-2',
				email: 'someone@example.com',
				emailVerified: true,
				nonce: null,
			}),
		);
		const res = await app.request(`/api/auth/callback?code=abc&state=${state}`, {
			headers: { cookie: login },
		});
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toContain('/login?error=');
		expect(cookieOf(res, 'session')).toBeNull();
	});

	it('email_verified が偽なら拒否する', async () => {
		const { app, login, state } = await startLogin(
			createFakeLoginProvider({
				sub: 'sub-1',
				email: 'me@example.com',
				emailVerified: false,
				nonce: null,
			}),
		);
		const res = await app.request(`/api/auth/callback?code=abc&state=${state}`, {
			headers: { cookie: login },
		});
		expect(res.headers.get('location')).toContain('/login?error=');
	});

	// 05-integration.md 3.4。state の素の照合が要る
	it('state が違えば拒否する', async () => {
		const { app, login } = await startLogin();
		const res = await app.request('/api/auth/callback?code=abc&state=forged', {
			headers: { cookie: login },
		});
		expect(res.headers.get('location')).toContain('/login?error=');
	});

	it('nonce が違えば拒否する', async () => {
		const { app, login, state } = await startLogin(
			createFakeLoginProvider({
				sub: 'sub-1',
				email: 'me@example.com',
				emailVerified: true,
				nonce: 'other',
			}),
		);
		const res = await app.request(`/api/auth/callback?code=abc&state=${state}`, {
			headers: { cookie: login },
		});
		expect(res.headers.get('location')).toContain('/login?error=');
	});

	it('照合用の Cookie が無ければ拒否する', async () => {
		const { app, state } = await startLogin();
		const res = await app.request(`/api/auth/callback?code=abc&state=${state}`);
		expect(res.headers.get('location')).toContain('/login?error=');
	});
});

describe('ログアウト（04-api.md 4.1）', () => {
	it('POST /api/auth/logout は Cookie を消す', async () => {
		const { request } = createAuthedApp(db);
		const res = await request('/api/auth/logout', { method: 'POST' });
		expect(res.status).toBe(204);
		expect(cookieOf(res, 'session')).toMatch(/Max-Age=0/);
	});

	// 全端末失効。基準時刻より前に発行された Cookie は、次のリクエストで 401 になる
	it('POST /api/auth/logout-all のあと、古い Cookie は 401 になり、新しく発行した Cookie は通る', async () => {
		const { app, request } = createAuthedApp(db);
		const old = await sessionCookie(Math.floor(Date.now() / 1000) - 10);
		expect((await app.request('/api/home', { headers: { cookie: old } })).status).toBe(200);

		const res = await request('/api/auth/logout-all', { method: 'POST', headers: { cookie: old } });
		expect(res.status).toBe(204);

		expect((await app.request('/api/home', { headers: { cookie: old } })).status).toBe(401);
		const fresh = await sessionCookie(Math.floor(Date.now() / 1000) + 1);
		expect((await app.request('/api/home', { headers: { cookie: fresh } })).status).toBe(200);
	});
});

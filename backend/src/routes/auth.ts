import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { AppError } from '../domain/app-error.js';
import type { AuthService, LoginChallenge } from '../services/auth.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';

// ログインの入口（04-api.md 4.1 / 05-integration.md 3.2 ①）。
// state・nonce・PKCE の verifier は署名付きの短命 Cookie に置き、コールバックで照合する（3.4）。
// SameSite=Lax の Cookie はトップレベルの GET には付くので、コールバックだけは state の素の照合が要る（04-api.md 2.2）

const LOGIN_COOKIE = 'login';
const LOGIN_COOKIE_MAX_AGE = 10 * 60;

function base64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64url');
}

function random(bytes: number): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// PKCE（S256）。コンフィデンシャルクライアントにも使う。実装が数行で済み、塞げるものは塞ぐ（3.4）
async function codeChallengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

export type AuthRouteConfig = { sessionSecret: string };

export function createAuthRoute(service: AuthService, config: AuthRouteConfig) {
	return (
		new Hono()
			// ログイン状態を返す。未ログインは 401。認証のミドルウェアが先に弾くので、ここへ来れば必ずログイン済み
			.get('/session', (c) => c.json({ authenticated: true }))

			.get('/login', async (c) => {
				const challenge: LoginChallenge = {
					state: random(32),
					nonce: random(32),
					codeVerifier: random(48),
				};
				// 中身は乱数だけで秘密ではないが、書き換えられないよう署名しておく
				const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url');
				const signature = await hmac(config.sessionSecret, payload);
				setCookie(c, LOGIN_COOKIE, `${payload}.${signature}`, {
					httpOnly: true,
					sameSite: 'Lax',
					secure: c.req.header('x-forwarded-proto') === 'https',
					path: '/api/auth',
					maxAge: LOGIN_COOKIE_MAX_AGE,
				});
				return c.redirect(
					service.authorizationUrl(challenge, await codeChallengeOf(challenge.codeVerifier)),
					302,
				);
			})

			.get('/callback', async (c) => {
				const raw = getCookie(c, LOGIN_COOKIE);
				deleteCookie(c, LOGIN_COOKIE, { path: '/api/auth' });
				try {
					const challenge = raw ? await readChallenge(config.sessionSecret, raw) : null;
					const code = c.req.query('code');
					const state = c.req.query('state');
					if (!challenge || !code || !state) {
						throw new AppError('NOT_ALLOWED', {
							message: 'ログインの手続きが途中で変わりました。もう一度ログインしてください',
						});
					}
					const session = await service.completeLogin(challenge, { code, state }, new Date());
					await setSessionCookie(c, config.sessionSecret, session);
				} catch (cause) {
					// 許可アドレス以外は 403（F-01 / N-03）。ブラウザはリダイレクト中なので JSON を見せず、
					// ログイン画面へ戻して拒否の文面を出させる（02-screens.md 3.1）
					if (cause instanceof AppError && cause.code === 'NOT_ALLOWED') {
						return c.redirect(`/login?error=${encodeURIComponent(cause.message)}`, 302);
					}
					throw cause;
				}
				return c.redirect('/', 302);
			})

			// この端末の Cookie を消す
			.post('/logout', (c) => {
				clearSessionCookie(c);
				return c.body(null, 204);
			})

			// 全端末を失効させる。この端末の Cookie も消す
			.post('/logout-all', async (c) => {
				await service.logoutAll(new Date());
				clearSessionCookie(c);
				return c.body(null, 204);
			})
	);
}

async function hmac(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return base64url(
		new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))),
	);
}

async function readChallenge(secret: string, raw: string): Promise<LoginChallenge | null> {
	const [payload, signature] = raw.split('.');
	if (!payload || !signature) return null;
	if ((await hmac(secret, payload)) !== signature) return null;
	try {
		const parsed = JSON.parse(
			Buffer.from(payload, 'base64url').toString('utf8'),
		) as Partial<LoginChallenge>;
		if (!parsed.state || !parsed.nonce || !parsed.codeVerifier) return null;
		return { state: parsed.state, nonce: parsed.nonce, codeVerifier: parsed.codeVerifier };
	} catch {
		return null;
	}
}

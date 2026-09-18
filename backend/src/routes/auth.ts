import { Hono } from 'hono';

import { AppError } from '../domain/app-error.js';
import type { AuthService } from '../services/auth.js';
import {
	codeChallengeOf,
	newChallenge,
	setChallengeCookie,
	takeChallengeCookie,
} from './oauth-challenge.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';

// ログインの入口（04-api.md 4.1 / 05-integration.md 3.2 ①）。
const LOGIN_COOKIE = 'login';
const LOGIN_COOKIE_PATH = '/api/auth';

export type AuthRouteConfig = { sessionSecret: string };

export function createAuthRoute(service: AuthService, config: AuthRouteConfig) {
	return (
		new Hono()
			// ログイン状態を返す。未ログインは 401。認証のミドルウェアが先に弾くので、ここへ来れば必ずログイン済み
			.get('/session', (c) => c.json({ authenticated: true }))

			.get('/login', async (c) => {
				const challenge = newChallenge();
				await setChallengeCookie(
					c,
					LOGIN_COOKIE,
					LOGIN_COOKIE_PATH,
					config.sessionSecret,
					challenge,
				);
				return c.redirect(
					service.authorizationUrl(challenge, await codeChallengeOf(challenge.codeVerifier)),
					302,
				);
			})

			.get('/callback', async (c) => {
				try {
					const challenge = await takeChallengeCookie(
						c,
						LOGIN_COOKIE,
						LOGIN_COOKIE_PATH,
						config.sessionSecret,
					);
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

import { Hono } from 'hono';

import { AppError } from '../domain/app-error.js';
import type { GoogleAuthorizationService } from '../services/google-authorization.js';
import {
	codeChallengeOf,
	newChallenge,
	setChallengeCookie,
	takeChallengeCookie,
} from './oauth-challenge.js';

// 04-api.md 4.2 の3本。返すのは有無・スコープ・認可日時だけで、トークンは返さない（NF-05）。
// セッション Cookie が要る（/api/* の認証の内側）。コールバックはトップレベルの GET なので Cookie が付く
const COOKIE = 'authorization';
const COOKIE_PATH = '/api/google/authorization';

export function createGoogleAuthorizationRoute(
	service: GoogleAuthorizationService,
	config: { sessionSecret: string },
) {
	return (
		new Hono()
			.get('/', async (c) => c.json(await service.status()))

			.get('/start', async (c) => {
				const challenge = newChallenge();
				await setChallengeCookie(c, COOKIE, COOKIE_PATH, config.sessionSecret, challenge);
				return c.redirect(
					service.authorizationUrl(challenge.state, await codeChallengeOf(challenge.codeVerifier)),
					302,
				);
			})

			// リフレッシュトークンを暗号化して保存 → 設定画面へ 302（4.2）。
			// 失敗はブラウザがリダイレクト中なので、設定画面へ理由つきで戻す（ログインのコールバックと同じ）
			.get('/callback', async (c) => {
				const challenge = await takeChallengeCookie(c, COOKIE, COOKIE_PATH, config.sessionSecret);
				const code = c.req.query('code');
				const state = c.req.query('state');
				try {
					if (!challenge || !code || !state) {
						throw new AppError('NOT_ALLOWED', {
							message: '認可の手続きが途中で変わりました。もう一度やり直してください',
						});
					}
					await service.complete({ code, state }, challenge.state, challenge.codeVerifier);
				} catch (cause) {
					if (cause instanceof AppError) {
						return c.redirect(`/settings?error=${encodeURIComponent(cause.message)}`, 302);
					}
					throw cause;
				}
				return c.redirect('/settings', 302);
			})
	);
}

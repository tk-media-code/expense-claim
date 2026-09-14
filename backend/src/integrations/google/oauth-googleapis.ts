import { OAuth2Client } from 'google-auth-library';

import { AppError } from '../../domain/app-error.js';
import type { IdentityClaims, LoginProvider } from './oauth.js';

export type GoogleOAuthConfig = {
	clientId: string;
	clientSecret: string;
	/** 事前に登録した固定 URL（05-integration.md 3.6） */
	redirectUri: string;
};

// google-auth-library の OAuth2Client でログインのフローを実装する（05-integration.md 3.2 ①）。
// tools/sheet-probe/auth.cjs と同じライブラリで、ID トークンの検証（verifyIdToken）もここに任せる。
export function createGoogleLoginProvider(config: GoogleOAuthConfig): LoginProvider {
	const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);

	return {
		authorizationUrl({ state, nonce, codeChallenge }) {
			return client.generateAuthUrl({
				// ログインに Gmail・ドライブ・スプレッドシートのスコープを求めない（01-architecture.md 3.7）
				scope: ['openid', 'email'],
				state,
				nonce,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256' as never,
			});
		},

		async exchange({ code, codeVerifier }) {
			const { tokens } = await client.getToken({
				code,
				codeVerifier,
				redirect_uri: config.redirectUri,
			});
			if (!tokens.id_token) {
				throw new AppError('NOT_ALLOWED', {
					message: 'Google から本人の情報を受け取れませんでした',
				});
			}
			// 署名・iss・aud・exp を確かめる（3.5 手順1）。nonce と email は services が見る
			const ticket = await client.verifyIdToken({
				idToken: tokens.id_token,
				audience: config.clientId,
			});
			const payload = ticket.getPayload();
			if (!payload) {
				throw new AppError('NOT_ALLOWED', {
					message: 'Google から本人の情報を受け取れませんでした',
				});
			}
			const claims: IdentityClaims = {
				sub: payload.sub,
				email: payload.email ?? null,
				emailVerified: payload.email_verified === true,
				nonce: payload.nonce ?? null,
			};
			return claims;
		},
	};
}

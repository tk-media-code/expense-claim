import { OAuth2Client } from 'google-auth-library';

import { authorizationOf, REQUIRED_SCOPES } from '../../domain/google-authorization.js';
import type { GoogleCredentialsRepository } from '../../repositories/google-credentials.js';
import type { GoogleAuthorizationClient, GoogleClientProvider } from './auth.js';
import { decryptToken, encryptToken } from './credentials.js';
import { classifyGoogleError, GoogleApiFailure } from './errors.js';

export type GoogleAuthConfig = {
	clientId: string;
	clientSecret: string;
	/** 事前に登録した固定 URL（05-integration.md 3.6）。ログインのものとは別 */
	redirectUri: string;
	/** リフレッシュトークンの暗号鍵（01-architecture.md 7.3） */
	tokenEncryptionKey: string;
};

// tools/sheet-probe/auth.cjs の移植（05-integration.md 2.3）。保存先がファイルから DB（暗号化）に変わる。
// access_type=offline でリフレッシュトークンを受け取り、prompt=consent で2回目以降も確実に得る（3.1）。
export function createGoogleAuth(
	config: GoogleAuthConfig,
	repository: GoogleCredentialsRepository,
): GoogleAuthorizationClient & GoogleClientProvider {
	function newClient(): OAuth2Client {
		return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
	}

	// アクセストークンはプロセスのメモリに置き、期限が来たらライブラリが取り直す（2.3）。
	// 再認可でリフレッシュトークンが変わるので、保存したときに捨てる
	let cached: OAuth2Client | null = null;

	return {
		async status() {
			return authorizationOf(await repository.find());
		},

		authorizationUrl({ state, codeChallenge }) {
			return newClient().generateAuthUrl({
				access_type: 'offline',
				prompt: 'consent',
				scope: Object.values(REQUIRED_SCOPES),
				state,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256' as never,
			});
		},

		async complete({ code, codeVerifier }) {
			let tokens;
			try {
				({ tokens } = await newClient().getToken({
					code,
					codeVerifier,
					redirect_uri: config.redirectUri,
				}));
			} catch (cause) {
				throw classifyGoogleError(cause);
			}
			if (!tokens.refresh_token) {
				// prompt=consent を付けているので通常は降ってくる。降ってこなければ認可は成立していない
				throw new GoogleApiFailure('unauthorized', null);
			}
			const now = new Date();
			await repository.save({
				refreshTokenEncrypted: await encryptToken(config.tokenEncryptionKey, tokens.refresh_token),
				scopeUrls: (tokens.scope ?? '').split(' ').filter(Boolean),
				authorizedAt: now,
			});
			cached = null;
		},

		async client() {
			if (cached) return cached;
			const stored = await repository.find();
			if (!stored) throw new GoogleApiFailure('unauthorized', null);
			const refreshToken = await decryptToken(
				config.tokenEncryptionKey,
				stored.refreshTokenEncrypted,
			);
			if (refreshToken === null) throw new GoogleApiFailure('unauthorized', null);

			const client = newClient();
			client.setCredentials({ refresh_token: refreshToken });
			// リフレッシュで新しいトークンが降ってきたら書き戻す（auth.cjs と同じ）
			client.on('tokens', (next) => {
				if (!next.refresh_token) return;
				void encryptToken(config.tokenEncryptionKey, next.refresh_token).then((encrypted) =>
					repository.replaceToken(encrypted, new Date()),
				);
			});
			cached = client;
			return client;
		},
	};
}

import { AppError } from '../domain/app-error.js';
import type { GoogleAuthorization } from '../domain/google-authorization.js';
import type { GoogleAuthorizationClient } from '../integrations/google/auth.js';
import { GoogleApiFailure } from '../integrations/google/errors.js';

// Google API の認可（04-api.md 4.2 / F-02）。ログインとは別に、一度だけ取る（05-integration.md 3.1）。
// services はトークンの存在を知らない。integrations が暗号化して保存し、ここは有無と流れだけを扱う
export function createGoogleAuthorizationService(client: GoogleAuthorizationClient) {
	return {
		status(): Promise<GoogleAuthorization> {
			return client.status();
		},

		authorizationUrl(state: string, codeChallenge: string): string {
			return client.authorizationUrl({ state, codeChallenge });
		},

		async complete(
			params: { code: string; state: string },
			expectedState: string,
			codeVerifier: string,
		): Promise<void> {
			if (params.state !== expectedState) {
				throw new AppError('NOT_ALLOWED', {
					message: '認可の手続きが途中で変わりました。もう一度やり直してください',
				});
			}
			try {
				await client.complete({ code: params.code, codeVerifier });
			} catch (cause) {
				if (cause instanceof GoogleApiFailure) throw new AppError('GOOGLE_UNAUTHORIZED', { cause });
				throw cause;
			}
		},
	};
}

export type GoogleAuthorizationService = ReturnType<typeof createGoogleAuthorizationService>;

import type { LoginProvider } from '../google/oauth.js';

// GOOGLE_STUB=1 のときのログイン。Google へ行かず、コールバックへ戻して許可アドレスで通す。
// 本番の compose.yaml はこの変数を渡さない。開発で画面を見るための道である。
export function createStubLoginProvider(allowedEmail: string): LoginProvider {
	return {
		authorizationUrl({ state, nonce }) {
			const code = Buffer.from(JSON.stringify({ nonce }), 'utf8').toString('base64url');
			return `/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
		},
		exchange({ code }) {
			let nonce: string | null = null;
			try {
				const parsed: unknown = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
				if (
					typeof parsed === 'object' &&
					parsed !== null &&
					'nonce' in parsed &&
					typeof parsed.nonce === 'string'
				) {
					nonce = parsed.nonce;
				}
			} catch {
				nonce = null;
			}
			return Promise.resolve({
				sub: 'dev-stub',
				email: allowedEmail,
				emailVerified: true,
				nonce,
			});
		},
	};
}

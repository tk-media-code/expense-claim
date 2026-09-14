import { AppError } from '../domain/app-error.js';
import { isExpired, isInvalidated, type Session } from '../domain/session.js';
import type { LoginProvider } from '../integrations/google/oauth.js';
import type { AuthStateRepository } from '../repositories/auth-state.js';

/** ログインを始めるときに作り、コールバックで照合する値（05-integration.md 3.4） */
export type LoginChallenge = { state: string; nonce: string; codeVerifier: string };

export type AuthConfig = {
	/** 許可するメールアドレス。環境変数で持つ（01-architecture.md 3.7 / N-18） */
	allowedEmail: string;
};

// ログインと、セッションの確かめ方（04-api.md 4.1 / 05-integration.md 3.5）。
// 利用者は本人1人（N-03）。権限モデルは無く、許可アドレスの照合だけで足りる。
export function createAuthService(
	provider: LoginProvider,
	authStateRepository: AuthStateRepository,
	config: AuthConfig,
) {
	return {
		authorizationUrl(challenge: LoginChallenge, codeChallenge: string): string {
			return provider.authorizationUrl({
				state: challenge.state,
				nonce: challenge.nonce,
				codeChallenge,
			});
		},

		// 3.5 の手順。どれか1つでも欠けたら 403（F-01 / N-03）。
		// hd（ホストドメイン）だけで判定しない。組織の誰でも入れることになる
		async completeLogin(
			challenge: LoginChallenge,
			params: { code: string; state: string },
			now: Date,
		): Promise<Session> {
			if (params.state !== challenge.state) {
				throw new AppError('NOT_ALLOWED', {
					message: 'ログインの手続きが途中で変わりました。もう一度ログインしてください',
				});
			}
			const claims = await provider.exchange({
				code: params.code,
				codeVerifier: challenge.codeVerifier,
			});
			if (claims.nonce !== challenge.nonce) {
				throw new AppError('NOT_ALLOWED', {
					message: 'ログインの手続きが途中で変わりました。もう一度ログインしてください',
				});
			}
			if (!claims.emailVerified || claims.email === null) {
				throw new AppError('NOT_ALLOWED', { message: 'このアカウントでは利用できません' });
			}
			// 大小を区別しない。メールアドレスのローカル部は厳密には区別されうるが、本人1人の照合で困らない
			if (claims.email.toLowerCase() !== config.allowedEmail.toLowerCase()) {
				throw new AppError('NOT_ALLOWED', { message: 'このアカウントでは利用できません' });
			}
			return { sub: claims.sub, iat: Math.floor(now.getTime() / 1000) };
		},

		// 04-api.md 4.1 の確かめる順序。署名は routes が確かめて渡してくる。
		// 2（失効）を 3（期限）より前に置き、通ったら呼び出し側が iat を今にして発行し直す（4）
		async verifySession(session: Session, now: Date): Promise<boolean> {
			const { sessionsValidAfter } = await authStateRepository.find();
			if (isInvalidated(session, sessionsValidAfter)) return false;
			if (isExpired(session, now)) return false;
			return true;
		},

		// 全端末を失効させる（04-api.md 4.1）。盗まれた端末の Cookie を90日待たずに切る
		async logoutAll(now: Date): Promise<void> {
			await authStateRepository.invalidateSessionsBefore(now);
		},
	};
}

export type AuthService = ReturnType<typeof createAuthService>;

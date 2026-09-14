import type { Hono } from 'hono';

import { createApp, type AppConfig } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import type { LoginProvider } from '../src/integrations/google/oauth.js';
import { signSession } from '../src/routes/session-cookie.js';

// 統合テストのための createApp。/api/* に認証が被さる（5-5）ので、ログイン済みの Cookie を
// 自動で載せる request を返す。Google は叩けないので偽物の LoginProvider を渡す。
export const TEST_CONFIG: AppConfig = {
	sessionSecret: 'test-session-secret-0123456789',
	allowedEmail: 'me@example.com',
	google: { clientId: '', clientSecret: '', redirectUriLogin: '' },
};

/** 偽物のログイン。exchange が返す本人の情報をテストが差し替える */
export function createFakeLoginProvider(
	claims: Awaited<ReturnType<LoginProvider['exchange']>> = {
		sub: 'sub-1',
		email: 'me@example.com',
		emailVerified: true,
		nonce: null,
	},
): LoginProvider & { lastParams: Parameters<LoginProvider['authorizationUrl']>[0] | null } {
	const provider = {
		lastParams: null as Parameters<LoginProvider['authorizationUrl']>[0] | null,
		authorizationUrl(params: Parameters<LoginProvider['authorizationUrl']>[0]) {
			provider.lastParams = params;
			return `https://accounts.example.test/o/oauth2/auth?state=${params.state}`;
		},
		exchange() {
			// nonce は発行されたものをそのまま返す（照合が通る）。テストがずらしたいときは claims.nonce を入れる
			return Promise.resolve({
				...claims,
				nonce: claims.nonce ?? provider.lastParams?.nonce ?? null,
			});
		},
	};
	return provider;
}

export async function sessionCookie(iat = Math.floor(Date.now() / 1000)): Promise<string> {
	return `session=${await signSession(TEST_CONFIG.sessionSecret, { sub: 'sub-1', iat })}`;
}

export type TestApp = {
	app: Hono;
	/** ログイン済みの Cookie を載せて叩く。既存のテストの app.request をそのまま置き換えられる */
	request(path: string, init?: RequestInit): Promise<Response>;
};

export function createAuthedApp(db: Database, loginProvider?: LoginProvider): TestApp {
	const app = createApp({
		db,
		config: TEST_CONFIG,
		loginProvider: loginProvider ?? createFakeLoginProvider(),
	});
	return {
		app,
		async request(path, init = {}) {
			const headers = new Headers(init.headers);
			if (!headers.has('cookie')) headers.set('cookie', await sessionCookie());
			return app.request(path, { ...init, headers });
		},
	};
}

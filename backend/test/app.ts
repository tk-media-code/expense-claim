import type { Hono } from 'hono';

import { createApp, type AppConfig } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { authorizationOf, type ScopeName } from '../src/domain/google-authorization.js';
import type {
	GoogleAuthorizationClient,
	GoogleClientProvider,
} from '../src/integrations/google/auth.js';
import { GoogleApiFailure } from '../src/integrations/google/errors.js';
import type { LoginProvider } from '../src/integrations/google/oauth.js';
import { signSession } from '../src/routes/session-cookie.js';

// 統合テストのための createApp。/api/* に認証が被さる（5-5）ので、ログイン済みの Cookie を
// 自動で載せる request を返す。Google は叩けないので偽物の LoginProvider を渡す。
export const TEST_CONFIG: AppConfig = {
	sessionSecret: 'test-session-secret-0123456789',
	allowedEmail: 'me@example.com',
	tokenEncryptionKey: 'test-token-encryption-key-0123',
	google: { clientId: '', clientSecret: '', redirectUriLogin: '', redirectUriAuthorization: '' },
	sheetName: '9999 テスト太郎',
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

/** 偽物の Google API の認可。認可の有無とスコープをテストが決め、complete で認可済みになる */
export function createFakeGoogleAuth(
	initial: { scopes: ScopeName[]; authorizedAt: Date } | null = null,
): GoogleAuthorizationClient &
	GoogleClientProvider & { completed: { code: string; codeVerifier: string }[] } {
	let credentials = initial;
	const fake = {
		completed: [] as { code: string; codeVerifier: string }[],
		status: () => Promise.resolve(authorizationOf(credentials)),
		authorizationUrl: ({ state }: { state: string; codeChallenge: string }) =>
			`https://accounts.example.test/o/oauth2/auth?scope=4&state=${state}`,
		complete: (params: { code: string; codeVerifier: string }) => {
			fake.completed.push(params);
			credentials = {
				scopes: ['gmail.readonly', 'gmail.send', 'drive.file', 'spreadsheets'],
				authorizedAt: new Date('2026-09-01T02:00:00Z'),
			};
			return Promise.resolve();
		},
		client: () => Promise.reject(new GoogleApiFailure('unauthorized', null)),
	};
	return fake;
}

export async function sessionCookie(iat = Math.floor(Date.now() / 1000)): Promise<string> {
	return `session=${await signSession(TEST_CONFIG.sessionSecret, { sub: 'sub-1', iat })}`;
}

export type TestApp = {
	app: Hono;
	/** ログイン済みの Cookie を載せて叩く。既存のテストの app.request をそのまま置き換えられる */
	request(path: string, init?: RequestInit): Promise<Response>;
};

export function createAuthedApp(
	db: Database,
	loginProvider?: LoginProvider,
	googleAuth?: GoogleAuthorizationClient & GoogleClientProvider,
): TestApp {
	const app = createApp({
		db,
		config: TEST_CONFIG,
		loginProvider: loginProvider ?? createFakeLoginProvider(),
		googleAuth: googleAuth ?? createFakeGoogleAuth(),
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

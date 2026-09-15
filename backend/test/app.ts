import type { Hono } from 'hono';

import { createApp, type AppConfig } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { authorizationOf, type ScopeName } from '../src/domain/google-authorization.js';
import type {
	GoogleAuthorizationClient,
	GoogleClientProvider,
} from '../src/integrations/google/auth.js';
import type { LoginProvider } from '../src/integrations/google/oauth.js';
import type { DriveClient, ReceiptFile } from '../src/integrations/drive/client.js';
import { DriveStep } from '../src/integrations/drive/googleapis.js';
import type { FetchedMail, GmailClient } from '../src/integrations/gmail/client.js';
import { GoogleApiFailure } from '../src/integrations/google/errors.js';
import type { SheetsClient, SheetStructure } from '../src/integrations/sheets/client.js';
import { AppError, type ErrorCode } from '../src/domain/app-error.js';
import { parseTargetMonth, type TargetMonth } from '../src/domain/month.js';
import { signSession } from '../src/routes/session-cookie.js';

// 統合テストのための createApp。/api/* に認証が被さる（5-5）ので、ログイン済みの Cookie を
// 自動で載せる request を返す。Google は叩けないので偽物の LoginProvider を渡す。
export const TEST_CONFIG: AppConfig = {
	sessionSecret: 'test-session-secret-0123456789',
	allowedEmail: 'me@example.com',
	tokenEncryptionKey: 'test-token-encryption-key-0123',
	google: { clientId: '', clientSecret: '', redirectUriLogin: '', redirectUriAuthorization: '' },
	googleStub: false,
	spreadsheetId: 'test-spreadsheet-id',
	sheetName: '9999 テスト太郎',
	gmailSender: 'requests@example.test',
	alertTo: 'me@example.test',
	driveFolderId: 'test-folder-id',
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

/** 偽物の提出シート。読める値をテストが決め、失敗させたければ fails に code を入れる */
export function createFakeSheets(
	options: {
		targetMonth?: string;
		venueMaster?: { code: string; name: string }[];
		structure?: Partial<SheetStructure>;
		fails?: ErrorCode | null;
	} = {},
): SheetsClient & { inserted: number[]; written: { rows: unknown[]; receiptCell: string }[] } {
	const fail = () => {
		if (options.fails) throw new AppError(options.fails);
	};
	const fake = {
		configured: true,
		inserted: [] as number[],
		written: [] as { rows: unknown[]; receiptCell: string }[],
		readTargetMonth: () => {
			fail();
			const month = parseTargetMonth(options.targetMonth ?? '2026-08');
			if (!month) throw new AppError('TARGET_MONTH_UNREADABLE');
			return Promise.resolve(month as TargetMonth);
		},
		readStructure: () => {
			fail();
			return Promise.resolve({
				spreadsheetTitle: '交通費精算',
				firstBodyRow: 8,
				lastBodyRow: 32,
				writableRows: 25,
				...options.structure,
			});
		},
		assertHeader: () => {
			fail();
			return Promise.resolve();
		},
		readVenueMaster: () => {
			fail();
			return Promise.resolve(options.venueMaster ?? []);
		},
		insertRows: (count: number) => {
			fake.inserted.push(count);
			return Promise.resolve();
		},
		writeBody: (rows: unknown[], receiptCell: string) => {
			fake.written.push({ rows, receiptCell });
			return Promise.resolve();
		},
	};
	return fake;
}

/** 偽物の Gmail。届いているメールをテストが決める。fails なら一覧が失敗する */
export function createFakeGmail(
	options: { mails?: FetchedMail[]; fails?: 'unauthorized' | 'other' | null } = {},
): GmailClient & { sent: { subject: string; body: string }[]; listedAfter: (string | null)[] } {
	const mails = options.mails ?? [];
	const fake = {
		configured: true,
		sent: [] as { subject: string; body: string }[],
		listedAfter: [] as (string | null)[],
		listRequestMailIds: (after: string | null) => {
			fake.listedAfter.push(after);
			if (options.fails)
				return Promise.reject(
					new GoogleApiFailure(options.fails, options.fails === 'unauthorized' ? 401 : 500),
				);
			return Promise.resolve(mails.map((mail) => mail.id));
		},
		fetch: (id: string) => {
			const mail = mails.find((m) => m.id === id);
			return mail ? Promise.resolve(mail) : Promise.reject(new GoogleApiFailure('not_found', 404));
		},
		sendAlert: (subject: string, body: string) => {
			fake.sent.push({ subject, body });
			return Promise.resolve();
		},
	};
	return fake;
}

/** 偽物のドライブ。保存したファイルを覚え、fails で保存か共有を落とせる */
export function createFakeDrive(
	options: { fails?: 'create' | 'share' | 'unauthorized' | null } = {},
): DriveClient & { stored: { name: string; mimeType: string; bytes: number }[] } {
	const fake = {
		configured: true,
		stored: [] as { name: string; mimeType: string; bytes: number }[],
		async store(file: ReceiptFile) {
			let bytes = 0;
			for await (const chunk of file.body as unknown as AsyncIterable<Uint8Array>)
				bytes += chunk.length;
			if (options.fails === 'unauthorized') throw new AppError('GOOGLE_UNAUTHORIZED');
			if (options.fails) {
				throw new AppError('DRIVE_UPLOAD_FAILED', { cause: new DriveStep(options.fails) });
			}
			fake.stored.push({ name: file.name, mimeType: file.mimeType, bytes });
			return {
				fileId: `file-${fake.stored.length}`,
				url: `https://drive.google.com/file/d/file-${fake.stored.length}/view`,
			};
		},
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
	sheetsClient?: SheetsClient,
	gmailClient?: GmailClient,
	driveClient?: DriveClient,
): TestApp {
	const app = createApp({
		db,
		config: TEST_CONFIG,
		loginProvider: loginProvider ?? createFakeLoginProvider(),
		googleAuth: googleAuth ?? createFakeGoogleAuth(),
		sheetsClient: sheetsClient ?? createFakeSheets(),
		gmailClient: gmailClient ?? createFakeGmail(),
		driveClient: driveClient ?? createFakeDrive(),
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

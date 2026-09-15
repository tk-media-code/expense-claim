import {
	authorizationOf,
	REQUIRED_SCOPES,
	type ScopeName,
} from '../../domain/google-authorization.js';
import { todayInJst, projectMonthOf, type TargetMonth } from '../../domain/month.js';
import type { DriveClient } from '../drive/client.js';
import type { GmailClient } from '../gmail/client.js';
import type { GoogleAuthorizationClient, GoogleClientProvider } from '../google/auth.js';
import { GoogleApiFailure } from '../google/errors.js';
import type { SheetsClient, SheetStructure, SubmissionRow } from '../sheets/client.js';

// Google を叩かない開発用の実装（GOOGLE_STUB=1）。E2E と、OAuth クライアントを持たない開発環境のためのもの。
// 01-architecture.md 5.3 のインターフェースがあるので、業務ロジックに一行も触れずに差し替えられる。
// 本番の compose.yaml はこの変数を渡さない。渡せば「提出できた」ように見えて、何も書かれない
//
// 提出シートの代わりは、対象月度 = JST の今月、書ける行は 8〜32 行、様式は合っている、会場マスタは空。
// 書いた矩形はメモリに置き、プロセスが終われば消える

export function createStubGoogle(): {
	auth: GoogleAuthorizationClient & GoogleClientProvider;
	sheets: SheetsClient;
	gmail: GmailClient;
	drive: DriveClient;
} {
	const scopes = Object.keys(REQUIRED_SCOPES) as ScopeName[];
	const authorizedAt = new Date('2026-01-01T00:00:00Z');
	const written: { rows: SubmissionRow[]; receiptCell: string; at: Date }[] = [];
	let structure: SheetStructure = {
		spreadsheetTitle: '（開発用の提出シート）',
		firstBodyRow: 8,
		lastBodyRow: 32,
		writableRows: 25,
	};
	let stored = 0;

	return {
		auth: {
			status: () => Promise.resolve(authorizationOf({ scopes, authorizedAt })),
			authorizationUrl: ({ state }) =>
				`/settings?error=${encodeURIComponent('開発用の設定では Google の認可を取れません')}&state=${state}`,
			complete: () => Promise.resolve(),
			client: () =>
				Promise.reject(
					new GoogleApiFailure('other', null, { message: '開発用の設定では Google を叩けません' }),
				),
		},
		sheets: {
			configured: true,
			readTargetMonth: () =>
				Promise.resolve(projectMonthOf(todayInJst(new Date())) as string as TargetMonth),
			readStructure: () => Promise.resolve(structure),
			assertHeader: () => Promise.resolve(),
			readVenueMaster: () => Promise.resolve([]),
			insertRows: (count) => {
				structure = {
					...structure,
					lastBodyRow: structure.lastBodyRow + count,
					writableRows: structure.writableRows + count,
				};
				return Promise.resolve();
			},
			writeBody: (rows, receiptCell) => {
				written.push({ rows, receiptCell, at: new Date() });
				console.log(`[stub sheets] wrote ${rows.length} rows`);
				return Promise.resolve();
			},
		},
		gmail: {
			configured: true,
			listRequestMailIds: () => Promise.resolve([]),
			fetch: (id) =>
				Promise.reject(
					new GoogleApiFailure('not_found', 404, {
						message: `開発用の設定にメール ${id} はありません`,
					}),
				),
			sendAlert: (subject) => {
				console.log(`[stub gmail] alert: ${subject}`);
				return Promise.resolve();
			},
		},
		drive: {
			configured: true,
			store: async (file) => {
				// 本文は読み捨てる
				for await (const _chunk of file.body as unknown as AsyncIterable<Uint8Array>) void _chunk;
				stored += 1;
				return {
					fileId: `stub-${stored}`,
					url: `https://drive.google.com/file/d/stub-${stored}/view`,
				};
			},
		},
	};
}

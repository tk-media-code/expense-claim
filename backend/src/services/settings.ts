import type { Settings } from '../domain/settings.js';
import type { GoogleAuthorizationClient } from '../integrations/google/auth.js';
import type { SheetsClient } from '../integrations/sheets/client.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';

export type SettingsConfig = {
	/** 自分のシート名。環境変数 MY_SHEET_NAME。空なら未設定 */
	sheetName: string;
};

// GET /api/settings（04-api.md 4.10）。スプレッドシートIDもフォルダIDも差出人アドレスも返さない
export function createSettingsService(
	syncStateRepository: SyncStateRepository,
	authorization: GoogleAuthorizationClient,
	sheets: SheetsClient,
	config: SettingsConfig,
) {
	// スプレッドシート名は提出シートから読む（8-3）。読めなければ null で、設定画面は開ける。
	// 認可が無い・共有が締められた、を設定画面が 502 / 503 で開けなくなる形にしない
	async function spreadsheetName(): Promise<string | null> {
		try {
			return (await sheets.readStructure()).spreadsheetTitle;
		} catch {
			return null;
		}
	}

	return {
		async get(): Promise<Settings> {
			const [syncState, google, name] = await Promise.all([
				syncStateRepository.find(),
				authorization.status(),
				spreadsheetName(),
			]);
			return {
				spreadsheetName: name,
				sheetName: config.sheetName === '' ? null : config.sheetName,
				targetMonth: syncState?.lastSeenTargetMonth ?? null,
				google: { authorized: google.authorized, missingScopes: google.missingScopes },
			};
		},
	};
}

export type SettingsService = ReturnType<typeof createSettingsService>;

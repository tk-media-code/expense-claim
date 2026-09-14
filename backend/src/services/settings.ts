import type { Settings } from '../domain/settings.js';
import type { GoogleAuthorizationClient } from '../integrations/google/auth.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';

export type SettingsConfig = {
	/** 自分のシート名。環境変数 MY_SHEET_NAME。空なら未設定 */
	sheetName: string;
};

// GET /api/settings（04-api.md 4.10）。スプレッドシートIDもフォルダIDも差出人アドレスも返さない。
// スプレッドシート名は Phase 8 で読む
export function createSettingsService(
	syncStateRepository: SyncStateRepository,
	authorization: GoogleAuthorizationClient,
	config: SettingsConfig,
) {
	return {
		async get(): Promise<Settings> {
			const [syncState, google] = await Promise.all([
				syncStateRepository.find(),
				authorization.status(),
			]);
			return {
				spreadsheetName: null,
				sheetName: config.sheetName === '' ? null : config.sheetName,
				targetMonth: syncState?.lastSeenTargetMonth ?? null,
				google: { authorized: google.authorized, missingScopes: google.missingScopes },
			};
		},
	};
}

export type SettingsService = ReturnType<typeof createSettingsService>;

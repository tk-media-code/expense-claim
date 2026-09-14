import type { GoogleAuthorization } from './google-authorization.js';
import type { TargetMonth } from './month.js';

// 設定画面に出すもの（04-api.md 4.10）。名前だけで、ID は持たない（N-08）
export type Settings = {
	/** 提出先スプレッドシートの名前。読めていなければ null（Phase 8 で入る） */
	spreadsheetName: string | null;
	/** 自分のシート名 */
	sheetName: string | null;
	/** 提出シートの A1 が決める対象月度。一度も同期していなければ null */
	targetMonth: TargetMonth | null;
	google: Pick<GoogleAuthorization, 'authorized' | 'missingScopes'>;
};

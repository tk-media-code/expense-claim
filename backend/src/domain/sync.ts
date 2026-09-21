import type { TargetMonth } from './month.js';

// 同期（POST /api/sync）の結果（04-api.md 4.3）。片方が失敗しても、もう片方は走る（2.6）。
// 失敗は warnings[] と要確認事項に載せ、200 で返す

export type SyncWarning = { code: string; message: string };

export type SyncResult = {
	/** 今回読めた対象月度。読めなければ null（前回の値は sync_state に残る） */
	targetMonth: TargetMonth | null;
	/** 月度が切り替わったか（F-32）。切り替わっていれば、切替先より前の実績は消えている */
	rolledOver: boolean;
	/** 取り込んだ案件の数。9-4 で実値になる */
	importedCount: number;
	warnings: SyncWarning[];
};

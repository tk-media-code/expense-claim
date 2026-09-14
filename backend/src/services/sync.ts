import { AppError } from '../domain/app-error.js';
import { formatMonthJa } from '../domain/month.js';
import type { SyncResult, SyncWarning } from '../domain/sync.js';
import type { SheetsClient } from '../integrations/sheets/client.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';
import type { AttentionsService } from './attentions.js';

// POST /api/sync（04-api.md 4.3）。提出シートの A1 を読んで対象月度を持ち、依頼メールを取り込む。
// 手順1〜2（月度の検知と削除）は 8-3 と 11-8、手順4〜5（取り込み）は 9-4 で育つ。
// 全体を1つのトランザクションにしない。手順ごとに効かせる（06-error-handling.md 6.4）
export function createSyncService(
	sheets: SheetsClient,
	syncStateRepository: SyncStateRepository,
	attentions: AttentionsService,
) {
	return {
		async run(now: Date): Promise<SyncResult> {
			const warnings: SyncWarning[] = [];
			const previous = await syncStateRepository.find();
			let targetMonth: SyncResult['targetMonth'] = null;
			let rolledOver = false;

			// 手順1。A1 を読み、last_seen_target_month と比べる（F-31 / F-32）。
			// 読めなくても取り込みは続ける（04-api.md 4.3「片方が失敗しても、もう片方は走る」）
			try {
				targetMonth = await sheets.readTargetMonth();
				rolledOver =
					previous?.lastSeenTargetMonth !== null &&
					previous?.lastSeenTargetMonth !== undefined &&
					previous.lastSeenTargetMonth !== targetMonth;
				await syncStateRepository.save({
					lastImportedAt: previous?.lastImportedAt ?? null,
					lastSeenTargetMonth: targetMonth,
					lastAlertSentOn: previous?.lastAlertSentOn ?? null,
					lastCronRunAt: previous?.lastCronRunAt ?? null,
					updatedAt: now,
				});
			} catch (cause) {
				const error =
					cause instanceof AppError ? cause : new AppError('SHEET_UNREACHABLE', { cause });
				if (!(cause instanceof AppError)) console.error(cause);
				warnings.push({ code: error.code, message: error.message });
				// 読めなかったことは、もう起きている（06-error-handling.md 3.2）。認可切れか共有停止かを文面に入れる（4.2）
				await attentions.record(
					'sheet_unreachable',
					error.code === 'GOOGLE_UNAUTHORIZED'
						? '対象月度を読もうとしましたが、Google の認可が切れています。設定から再認可してください'
						: `対象月度を読もうとしましたが、提出シートに届きませんでした（${error.message}）。共有が続いているか確かめてください`,
					now,
				);
			}

			if (rolledOver && targetMonth) {
				// 11-8 で削除と「提出せずに切り替わった」を足す。ここでは切り替わったことだけ返す
				warnings.push({
					code: 'TARGET_MONTH_ROLLED_OVER',
					message: `対象月度が${formatMonthJa(targetMonth)}に切り替わりました`,
				});
			}

			return { targetMonth, rolledOver, importedCount: 0, warnings };
		},
	};
}

export type SyncService = ReturnType<typeof createSyncService>;

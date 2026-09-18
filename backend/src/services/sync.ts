import { AppError } from '../domain/app-error.js';
import { parseRequestMail } from '../domain/mail-parse.js';
import { addDays, formatMonthJa, todayInJst, type ProjectMonth } from '../domain/month.js';
import type { SyncResult, SyncWarning } from '../domain/sync.js';
import type { GmailClient } from '../integrations/gmail/client.js';
import { classifyGoogleError } from '../integrations/google/errors.js';
import type { SheetsClient } from '../integrations/sheets/client.js';
import type { ImportedMailsRepository } from '../repositories/imported-mails.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';
import type { AttentionsService } from './attentions.js';

// POST /api/sync（04-api.md 4.3）。提出シートの A1 を読んで対象月度を持ち、依頼メールを取り込む。
// 手順2〜3（月度切替の削除と要確認事項）は 11-8 で育つ。
// 全体を1つのトランザクションにしない。手順ごとに効かせる（06-error-handling.md 6.4）
export function createSyncService(
	sheets: SheetsClient,
	gmail: GmailClient,
	syncStateRepository: SyncStateRepository,
	importedMailsRepository: ImportedMailsRepository,
	projectsRepository: ProjectsRepository,
	attentions: AttentionsService,
) {
	function formatJst(date: Date | null): string {
		if (!date) return '日時不明';
		const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
		return `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()} ${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
	}

	// 手順4。1通ずつ囲む。途中で落ちても取り込めたぶんは残り、次回スキップされる（06-error-handling.md 6.4）。
	// 取り込みは月度で絞らない（05-integration.md 4.4）。1回の実行で複数の月度の案件ができる
	async function importMails(
		lastImportedAt: Date | null,
		now: Date,
		warnings: SyncWarning[],
	): Promise<{ imported: number; failed: boolean }> {
		if (!gmail.configured) {
			warnings.push({
				code: 'GMAIL_NOT_CONFIGURED',
				message: '依頼メールの差出人アドレスが設定されていないので、取り込めません',
			});
			return { imported: 0, failed: true };
		}
		let ids: string[];
		try {
			// 前回の取り込み日の1日前から。境界が日付粒度なので広めに取り、id で弾く（4.1）
			const after = lastImportedAt ? addDays(todayInJst(lastImportedAt), -1) : null;
			ids = await gmail.listRequestMailIds(after);
		} catch (cause) {
			const failure = classifyGoogleError(cause);
			warnings.push({
				code: failure.kind === 'unauthorized' ? 'GOOGLE_UNAUTHORIZED' : 'GMAIL_UNREACHABLE',
				message:
					failure.kind === 'unauthorized'
						? '依頼メールを読もうとしましたが、Google の認可が切れています。設定から再認可してください'
						: `依頼メールを読めませんでした（${failure.message}）`,
			});
			return { imported: 0, failed: true };
		}

		const known = await importedMailsRepository.existingIds(ids);
		let imported = 0;
		let failed = false;
		for (const id of ids) {
			if (known.has(id)) continue;
			try {
				const mail = await gmail.fetch(id);
				const meta = { id: mail.id, threadId: mail.threadId, internalDate: mail.internalDate };
				const parsed = parseRequestMail(mail.subject, mail.plainBody);
				if (parsed.kind === 'project') {
					if (
						(await importedMailsRepository.recordProject(meta, parsed.project, now)) === 'created'
					) {
						imported += 1;
					}
				} else if (parsed.kind === 'no_request') {
					await importedMailsRepository.record(meta, 'no_request', now);
				} else if (parsed.kind === 'unrelated') {
					// 依頼以外のメール（決定23）。記録して次回は飛ばす。要確認事項にはしない
					await importedMailsRepository.record(meta, 'unrelated', now);
				} else {
					// F-07。裏取りが通らなかった。件名・受信日時・取り出せなかった項目名を残し、本文は残さない（4.2）
					await importedMailsRepository.record(meta, 'parse_failed', now);
					await attentions.record(
						'mail_parse_failed',
						`${formatJst(mail.internalDate)} に届いた件名「${mail.subject}」のメールから、${parsed.missing.join('・')}を取り出せませんでした。案件を手で足してください`,
						now,
					);
				}
			} catch (cause) {
				const failure = classifyGoogleError(cause);
				console.error(failure);
				warnings.push({
					code: 'GMAIL_UNREACHABLE',
					message: `メールを1通読めませんでした（${failure.message}）`,
				});
				failed = true;
			}
		}
		return { imported, failed };
	}

	return {
		async run(now: Date): Promise<SyncResult> {
			const warnings: SyncWarning[] = [];
			const previous = await syncStateRepository.find();
			let rolledOver = false;

			// 手順1。A1 を読み、last_seen_target_month と比べる（F-31 / F-32）。
			// 読めなくても取り込みは続ける（04-api.md 4.3「片方が失敗しても、もう片方は走る」）
			let readMonth: SyncResult['targetMonth'] = null;
			if (!sheets.configured) {
				// 未設定は「届かない」とは別のこと。叩かず、要確認事項にも積まない（起きたことではなく設定の不足）
				warnings.push({
					code: 'SHEET_NOT_CONFIGURED',
					message: '提出シートが設定されていないので、対象月度を読めません',
				});
			} else {
				try {
					readMonth = await sheets.readTargetMonth();
					rolledOver =
						previous?.lastSeenTargetMonth != null && previous.lastSeenTargetMonth !== readMonth;
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
			}

			if (rolledOver && readMonth) {
				// 手順2。切替先より前で、かつ提出が済んだ月度の実績を消す（F-32 / 03-database.md 6.3）。確認を挟まない（決定10）
				const deleted = await projectsRepository.deleteSubmittedBefore(readMonth);
				warnings.push({
					code: 'TARGET_MONTH_ROLLED_OVER',
					message: `対象月度が${formatMonthJa(readMonth)}に切り替わりました${deleted > 0 ? `。提出済みの案件${deleted}件を消しました` : ''}`,
				});
				// 手順3。消さずに残ったもの（切替先より前で未提出）を、月度ごとに要確認事項へ（02-screens.md 4.4）。
				// 切替先以降の月度は出さない。これから稼働する案件で、異常ではない
				const leftover = await projectsRepository.listBefore(readMonth);
				const byMonth = new Map<string, number>();
				for (const project of leftover)
					byMonth.set(project.month, (byMonth.get(project.month) ?? 0) + 1);
				for (const [month, count] of byMonth) {
					await attentions.record(
						'month_rolled_over_unsubmitted',
						`提出せずに月度が${formatMonthJa(readMonth)}へ切り替わりました。${formatMonthJa(month as ProjectMonth)}の案件${count}件が残っています。アプリでは扱えないので、提出シートの運用に従って手で入力してください`,
						now,
					);
				}
			}

			// 手順4〜5。取り込み、last_imported_at を更新する。1件も取り込まなかった実行でも更新するが、
			// Gmail の取り込みが失敗した実行では更新しない（06-error-handling.md 6.4）
			const { imported, failed } = await importMails(
				previous?.lastImportedAt ?? null,
				now,
				warnings,
			);

			await syncStateRepository.save({
				lastImportedAt: failed ? (previous?.lastImportedAt ?? null) : now,
				lastSeenTargetMonth: readMonth ?? previous?.lastSeenTargetMonth ?? null,
				lastAlertSentOn: previous?.lastAlertSentOn ?? null,
				lastCronRunAt: previous?.lastCronRunAt ?? null,
				updatedAt: now,
			});

			return { targetMonth: readMonth, rolledOver, importedCount: imported, warnings };
		},
	};
}

export type SyncService = ReturnType<typeof createSyncService>;

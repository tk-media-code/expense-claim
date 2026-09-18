import { AppError } from '../domain/app-error.js';
import {
	dayOfMonth,
	firstDayOfNextMonth,
	formatMonthJa,
	todayInJst,
	type CalendarDate,
	type TargetMonth,
} from '../domain/month.js';
import type { GmailClient } from '../integrations/gmail/client.js';
import { classifyGoogleError } from '../integrations/google/errors.js';
import type { SheetsClient } from '../integrations/sheets/client.js';
import type { ExpenseRecordsRepository } from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { SubmissionsRepository } from '../repositories/submissions.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';
import type { AttentionsService } from './attentions.js';

export type AlertConfig = {
	/** メールに載せるアプリの URL。空なら載せない */
	appUrl: string;
};

export type AlertOutcome =
	| { kind: 'skipped'; reason: 'not_alert_day' | 'already_sent_today' | 'submitted' }
	| { kind: 'sent'; targetMonth: TargetMonth | null }
	| { kind: 'failed' };

// 提出アラート（F-35 / F-36 / 要件定義 7.5）。scheduler コンテナが1日1回起動して呼ぶ（01-architecture.md 3.8）。
// 持ってよいのは、送るか送らないかの判断と送信だけ。データを変えない（要件定義 2.1 (3)）。
// 例外は sync_state の cron の死活と last_alert_sent_on の更新で、これは「送ったか」の記録である
export function createAlertService(
	sheets: SheetsClient,
	gmail: GmailClient,
	syncStateRepository: SyncStateRepository,
	submissionsRepository: SubmissionsRepository,
	projectsRepository: ProjectsRepository,
	expenseRecordsRepository: ExpenseRecordsRepository,
	attentions: AttentionsService,
	config: AlertConfig,
) {
	async function touchCronRun(now: Date, patch: { lastAlertSentOn?: CalendarDate }): Promise<void> {
		const previous = await syncStateRepository.find();
		await syncStateRepository.save({
			lastImportedAt: previous?.lastImportedAt ?? null,
			lastSeenTargetMonth: previous?.lastSeenTargetMonth ?? null,
			lastAlertSentOn: patch.lastAlertSentOn ?? previous?.lastAlertSentOn ?? null,
			lastCronRunAt: now,
			updatedAt: now,
		});
	}

	/** 対象月度の案件の、記録済みと未記録の件数（要件定義 4.10） */
	async function countRecords(
		targetMonth: TargetMonth,
	): Promise<{ recorded: number; unrecorded: number }> {
		const projects = await projectsRepository.listInMonth(targetMonth);
		const records = await expenseRecordsRepository.summarize(projects.map((p) => p.id));
		const recorded = projects.filter((p) => records.has(p.id)).length;
		return { recorded, unrecorded: projects.length - recorded };
	}

	return {
		async run(now: Date): Promise<AlertOutcome> {
			// 手順1。起動するたびに走った時刻を残す。1日でも3日でもない日も（06-error-handling.md 7.2）
			await touchCronRun(now, {});

			// 手順2。その日が1日でも3日でもなければ、何もせずに終わる。JST の暦日で判定する（03-database.md 4.2）
			const today = todayInJst(now);
			const day = dayOfMonth(today);
			if (day !== 1 && day !== 3) return { kind: 'skipped', reason: 'not_alert_day' };

			// 同じ日に2通送らない。再デプロイやコンテナの再起動で同じ日にもう一度起動しうる（03-database.md 5.3）
			const state = await syncStateRepository.find();
			if (state?.lastAlertSentOn === today)
				return { kind: 'skipped', reason: 'already_sent_today' };

			// 手順3。対象月度を読む。読めなかったときは対象月度を書かずに送る（要件定義 7.5）。
			// 提出シートが読めないこと自体が、知らせるに値する。読めなかったことは要確認事項に残す（06-error-handling.md 3.1）
			let targetMonth: TargetMonth | null = null;
			try {
				targetMonth = await sheets.readTargetMonth();
			} catch (cause) {
				const error =
					cause instanceof AppError ? cause : new AppError('SHEET_UNREACHABLE', { cause });
				console.error(error);
				await attentions.record(
					'sheet_unreachable',
					error.code === 'GOOGLE_UNAUTHORIZED'
						? '提出アラートのために対象月度を読もうとしましたが、Google の認可が切れています。設定から再認可してください'
						: `提出アラートのために対象月度を読もうとしましたが、提出シートに届きませんでした（${error.message}）。共有が続いているか確かめてください`,
					now,
				);
			}

			// 手順4。その月度の提出記録があれば、何もせずに終わる（F-36）
			if (targetMonth !== null && (await submissionsRepository.findLatest(targetMonth)) !== null) {
				return { kind: 'skipped', reason: 'submitted' };
			}

			// 手順5。本人のアドレスあてに1通送る（宛先は integrations が環境変数から取る）
			const counts = targetMonth ? await countRecords(targetMonth) : null;
			const { subject, body } = composeAlert(targetMonth, day, today, counts, config.appUrl);
			try {
				await gmail.sendAlert(subject, body);
			} catch (cause) {
				const failure = classifyGoogleError(cause);
				console.error(failure);
				// 送信に失敗したら要確認事項に残す（alert_send_failed）。宛先は入れない（06-error-handling.md 4.2）
				await attentions.record(
					'alert_send_failed',
					`${targetMonth ? formatMonthJa(targetMonth) : '対象月度不明'}の提出アラート（${day}日ぶん）を送れませんでした（${failure.message}）`,
					now,
				);
				return { kind: 'failed' };
			}
			await touchCronRun(now, { lastAlertSentOn: today });
			return { kind: 'sent', targetMonth };
		},
	};
}

/** 載せるもの（要件定義 4.10）：対象月度・締切（その月の3日正午）・記録済みと未記録の件数・アプリの URL。要確認事項の件数は載せない */
export function composeAlert(
	targetMonth: TargetMonth | null,
	day: number,
	today: CalendarDate,
	counts: { recorded: number; unrecorded: number } | null,
	appUrl: string,
): { subject: string; body: string } {
	// 締切は翌月3日正午。対象月度が読めていればその翌月、読めていなければ今月の3日
	const deadlineMonth = targetMonth ? firstDayOfNextMonth(targetMonth) : today;
	const [year, month] = deadlineMonth.split('-').map(Number);
	const deadline = `${year}年${month}月3日 正午`;
	const monthLabel = targetMonth
		? formatMonthJa(targetMonth)
		: '対象月度（提出シートを読めませんでした）';
	const subject =
		day === 1
			? `【交通費】${monthLabel}の提出がまだです`
			: `【交通費】${monthLabel}の提出期限は本日正午です`;
	const lines = [`${monthLabel}の交通費がまだ提出されていません。`, `締切: ${deadline}`, ''];
	if (counts) {
		lines.push(`記録済み: ${counts.recorded}件 / 未記録: ${counts.unrecorded}件`);
		if (counts.unrecorded > 0)
			lines.push('未記録の案件があります。先に記録してから提出してください。');
	} else {
		lines.push(
			'提出シートを読めなかったため、対象月度と件数を確かめられませんでした。設定の Google との連携と、シートの共有を確かめてください。',
		);
	}
	if (appUrl !== '') lines.push('', appUrl);
	return { subject, body: lines.join('\n') };
}

export type AlertService = ReturnType<typeof createAlertService>;

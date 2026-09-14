import { AppError } from '../domain/app-error.js';
import { formatMonthJa, type TargetMonth } from '../domain/month.js';
import {
	buildSubmission,
	rowsToInsert,
	type BuiltSubmission,
	type SubmissionSource,
} from '../domain/submission.js';
import type { SubmissionPreview, SubmissionResult } from '../domain/submission-preview.js';
import type { SheetsClient, SheetStructure } from '../integrations/sheets/client.js';
import type { AttentionsRepository } from '../repositories/attentions.js';
import type { ExpenseRecordsRepository } from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { SubmissionsRepository } from '../repositories/submissions.js';
import type { TaxiRidesRepository } from '../repositories/taxi-rides.js';
import type { AttentionsService } from './attentions.js';

// 提出（04-api.md 4.8 / 6章 / 要件定義 5.2）。確認（preview）と実行（execute）の2段構え。
// 実行はプレビューの結果を持ち回さず、手順1〜7 をやり直してから書く（6.1）。
// 中止条件はすべて書き込みより前に並んでいる（06-error-handling.md 5.1）
export function createSubmissionsService(
	sheets: SheetsClient,
	projectsRepository: ProjectsRepository,
	expenseRecordsRepository: ExpenseRecordsRepository,
	taxiRidesRepository: TaxiRidesRepository,
	submissionsRepository: SubmissionsRepository,
	attentionsRepository: AttentionsRepository,
	attentions: AttentionsService,
) {
	// 手順1〜3。読めなかったことは、もう起きている。プレビューでも要確認事項に残す（06-error-handling.md 3.2 / 5.2）。
	// 様式の変更（SHEET_FORMAT_CHANGED）だけは残さない。本人はいま画面を見ている
	async function readSheet(
		now: Date,
	): Promise<{ targetMonth: TargetMonth; structure: SheetStructure }> {
		try {
			const targetMonth = await sheets.readTargetMonth();
			const structure = await sheets.readStructure();
			await sheets.assertHeader();
			return { targetMonth, structure };
		} catch (cause) {
			const error =
				cause instanceof AppError ? cause : new AppError('SHEET_UNREACHABLE', { cause });
			if (!(cause instanceof AppError)) console.error(cause);
			if (error.code !== 'SHEET_FORMAT_CHANGED') {
				await attentions.record(
					'sheet_unreachable',
					error.code === 'GOOGLE_UNAUTHORIZED'
						? '提出のために提出シートを読もうとしましたが、Google の認可が切れています。設定から再認可してください'
						: `提出のために提出シートを読もうとしましたが、届きませんでした（${error.message}）。共有が続いているか確かめてください`,
					now,
				);
			}
			throw error;
		}
	}

	// 手順4〜6。対象月度の案件を行に展開し、会場コードをマスタと突き合わせる
	async function build(targetMonth: TargetMonth): Promise<BuiltSubmission> {
		const projects = await projectsRepository.listInMonth(targetMonth);
		const ids = projects.map((p) => p.id);
		const [records, rides, master] = await Promise.all([
			expenseRecordsRepository.findByProjectIds(ids),
			taxiRidesRepository.listForSubmission(ids),
			sheets.readVenueMaster(),
		]);
		const sources: SubmissionSource[] = projects.map((project) => ({
			project,
			record: records.get(project.id) ?? null,
			taxiRides: rides.filter((ride) => ride.projectId === project.id),
		}));
		return buildSubmission(sources, new Set(master.map((row) => row.code)));
	}

	return {
		// 手順1〜7。書かない
		async preview(now: Date): Promise<SubmissionPreview> {
			const { targetMonth, structure } = await readSheet(now);
			const built = await build(targetMonth);
			const [latest, attentionCount] = await Promise.all([
				submissionsRepository.findLatest(targetMonth),
				attentionsRepository.countUnchecked(),
			]);
			return {
				targetMonth,
				lastSubmittedAt: latest?.executedAt ?? null,
				attentionCount,
				rows: built.rows,
				receiptCell: built.receiptCell,
				writableRows: structure.writableRows,
				rowsToInsert: rowsToInsert(built.rows.length, structure.writableRows),
				warnings: built.warnings,
			};
		},

		// 手順1〜7 をやり直し、送られた targetMonth と照合してから手順8 を実行する（6.2）
		async execute(expected: TargetMonth, now: Date): Promise<SubmissionResult> {
			const { targetMonth, structure: readStructure } = await readSheet(now);
			if (targetMonth !== expected) throw new AppError('TARGET_MONTH_CHANGED');
			const built = await build(targetMonth);

			// 手順5。足りなければ書き込める範囲の内側に挿入し、構造を読み直す（05-integration.md 8.3）。
			// 挿入した時点で要確認事項に積む。委託元の資産に手を入れたことは、書き込みの成否と関係なく残す
			let structure = readStructure;
			const inserting = rowsToInsert(built.rows.length, structure.writableRows);
			if (inserting > 0) {
				await sheets.insertRows(inserting);
				await attentions.record(
					'rows_inserted',
					`${formatMonthJa(targetMonth)}の提出で本文行が足りず、${structure.lastBodyRow}行目の内側に${inserting}行を挿入しました。提出シートの構造が変わっています`,
					now,
				);
				structure = await sheets.readStructure();
			}

			// 手順8。本文行の矩形を1回で書く（8.2）。書けたら submissions を1行足す。
			// シートが先・submissions が後（06-error-handling.md 6.3）。後で落ちたら 502
			await sheets.writeBody(
				built.rows.map((row) => row.cells),
				built.receiptCell,
			);
			try {
				await submissionsRepository.add(targetMonth, now, built.rows.length);
			} catch (cause) {
				console.error(cause);
				throw new AppError('SHEET_UNREACHABLE', {
					message:
						'提出シートには書き込めましたが、提出の記録を残せませんでした。もう一度実行してください',
					cause,
				});
			}
			// 実行では venue_code_unknown を積む（06-error-handling.md 3.2）。書いて初めて起きる
			for (const warning of built.warnings) {
				if (warning.code !== 'VENUE_CODE_UNKNOWN') continue;
				const source = built.rows.find((row) => row.projectId === warning.projectId);
				await attentions.record(
					'venue_code_unknown',
					`${warning.message}。${source?.cells.A ?? ''} ${source?.cells.D ?? ''} の行にそのまま書きました。会場をアプリに追加するか、委託元に確かめてください`,
					now,
				);
			}
			return { writtenRows: built.rows.length, rowsInserted: inserting, warnings: built.warnings };
		},
	};
}

export type SubmissionsService = ReturnType<typeof createSubmissionsService>;

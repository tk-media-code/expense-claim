import type { TargetMonth } from './month.js';
import type { SubmissionRow, SubmissionWarning } from './submission.js';

// POST /api/submissions/preview の応答（04-api.md 5.4）。書かない
export type SubmissionPreview = {
	targetMonth: TargetMonth;
	/**
	 * 書き込み先。スプレッドシートの名前と自分のシートの名前で、ID は出さない（N-08。設定画面と同じ）。
	 * 環境変数の指し先を本人が実行前に目で確かめられるようにする。2026-09-18 に、サンドボックスのつもりで
	 * 本番のシートへ書いたことがある
	 */
	destination: { spreadsheetTitle: string; sheetTitle: string };
	/** 前回の提出日時（F-30）。無ければ null */
	lastSubmittedAt: Date | null;
	/** 未確認の要確認事項の件数 */
	attentionCount: number;
	rows: SubmissionRow[];
	receiptCell: string;
	/** 書ける行数（実行時に読んだ値。NF-09） */
	writableRows: number;
	/** 挿入する行数。実行する前に知らせる */
	rowsToInsert: number;
	warnings: SubmissionWarning[];
};

// POST /api/submissions の応答（04-api.md 6章）
export type SubmissionResult = {
	writtenRows: number;
	rowsInserted: number;
	warnings: SubmissionWarning[];
};

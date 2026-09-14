import type { TargetMonth } from './month.js';
import type { SubmissionRow, SubmissionWarning } from './submission.js';

// POST /api/submissions/preview の応答（04-api.md 5.4）。書かない
export type SubmissionPreview = {
	targetMonth: TargetMonth;
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

// backend/src/domain/submission*.ts の写し（契約の写し。types/station.ts と同じ理由）
export type SubmissionCells = {
	A: string | null;
	B: string | null;
	C: string | null;
	D: string | null;
	E: string;
	F: string;
	G: string;
	H: number;
	I: number | null;
};

export type SubmissionRow = { no: number; projectId: number; cells: SubmissionCells };

export type SubmissionWarning = {
	code: 'VENUE_CODE_UNKNOWN' | 'NO_EXPENSE_RECORD';
	message: string;
	projectId: number;
};

/** POST /api/submissions/preview（04-api.md 5.4） */
export type SubmissionPreview = {
	targetMonth: string;
	lastSubmittedAt: string | null;
	attentionCount: number;
	rows: SubmissionRow[];
	receiptCell: string;
	writableRows: number;
	rowsToInsert: number;
	warnings: SubmissionWarning[];
};

/** POST /api/submissions（04-api.md 6章） */
export type SubmissionResult = {
	writtenRows: number;
	rowsInserted: number;
	warnings: SubmissionWarning[];
};

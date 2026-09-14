import type { ExpenseRecordLeg, TripType } from './expense-record.js';
import { formatForSheet, type CalendarDate, type TargetMonth } from './month.js';
import type { Project } from './project.js';

// 提出行の生成（要件定義 5.2 手順4〜6 / 5.3 / 5.4）。domain はどの層にも依存しない。
// 加工は記録時に済んでいる（03-database.md 7.2）。ここでは legs を行に写し、先頭行にだけ A〜D と I を置く。
// 提出時に計算を残さない

/** 提出シートの1行（A〜I）。値は書き込む形のまま（04-api.md 5.4）。J〜L は常に空で、応答に出さない */
export type SubmissionCells = {
	/** 施行日。`2026/8/22`。案件の先頭行にだけ */
	A: string | null;
	/** 会場コード。先頭行にだけ */
	B: string | null;
	/** 目的。常に `婚礼案件`。先頭行にだけ */
	C: string | null;
	/** ご両家名。先頭行にだけ */
	D: string | null;
	E: string;
	F: string;
	/** `往復` または `片道`。全行に */
	G: string;
	H: number;
	/** その案件のタクシー代の合計。先頭行にだけ。乗車が無ければ null */
	I: number | null;
};

export type SubmissionRow = { no: number; projectId: number; cells: SubmissionCells };

export type SubmissionWarning = {
	code: 'VENUE_CODE_UNKNOWN' | 'NO_EXPENSE_RECORD';
	message: string;
	projectId: number;
};

/** 行を組むために要る、案件ごとの材料 */
export type SubmissionSource = {
	project: Pick<
		Project,
		'id' | 'projectNo' | 'serviceDate' | 'venueCode' | 'venueName' | 'coupleName'
	>;
	/** 交通費記録。無ければ飛ばして警告する（要件定義 5.5） */
	record: { tripType: TripType; legs: ExpenseRecordLeg[] } | null;
	/** 乗車日の昇順 */
	taxiRides: { rodeOn: CalendarDate; amount: number; driveUrl: string }[];
};

export type BuiltSubmission = {
	rows: SubmissionRow[];
	/** M8 に書く文面（5.4）。無ければ空 */
	receiptCell: string;
	warnings: SubmissionWarning[];
};

const PURPOSE = '婚礼案件';

function tripLabel(tripType: TripType): string {
	return tripType === 'round' ? '往復' : '片道';
}

/** `(9/5)` の見出し（5.4）。年は書かない */
function dateHeading(date: CalendarDate): string {
	const [, month, day] = date.split('-').map(Number);
	return `(${month}/${day})`;
}

/**
 * 案件の並び（5.3）は呼び出し側が施行日の昇順・案件番号の昇順で渡す。
 * venueCodes は提出シートの会場マスタ（05-integration.md 7.4）。無いコードは警告して、そのまま書く（N-14）
 */
export function buildSubmission(
	sources: SubmissionSource[],
	venueCodes: Set<string>,
): BuiltSubmission {
	const rows: SubmissionRow[] = [];
	const warnings: SubmissionWarning[] = [];
	const receipts: { rodeOn: CalendarDate; driveUrl: string }[] = [];

	for (const { project, record, taxiRides } of sources) {
		if (record === null) {
			// 中止しない（要件定義 5.5）。飛ばして警告する。要確認事項には積まない（異常ではない）
			warnings.push({
				code: 'NO_EXPENSE_RECORD',
				message: `${formatForSheet(project.serviceDate)} ${project.venueName} は交通費の記録がありません。この案件は書き込みません`,
				projectId: project.id,
			});
			continue;
		}
		if (!venueCodes.has(project.venueCode)) {
			warnings.push({
				code: 'VENUE_CODE_UNKNOWN',
				message: `会場コード ${project.venueCode} が会場マスタにありません`,
				projectId: project.id,
			});
		}
		const taxiTotal = taxiRides.reduce((sum, ride) => sum + ride.amount, 0);
		record.legs.forEach((leg, index) => {
			const first = index === 0;
			rows.push({
				no: rows.length + 1,
				projectId: project.id,
				cells: {
					A: first ? formatForSheet(project.serviceDate) : null,
					B: first ? project.venueCode : null,
					C: first ? PURPOSE : null,
					D: first ? project.coupleName : null,
					E: leg.fromStationName,
					F: leg.toStationName,
					G: tripLabel(record.tripType),
					H: leg.amount,
					I: first && taxiRides.length > 0 ? taxiTotal : null,
				},
			});
		});
		// 領収書は書いた案件のぶんだけ（5.4「本文行と同じ絞り込みを使う」）
		receipts.push(...taxiRides.map((ride) => ({ rodeOn: ride.rodeOn, driveUrl: ride.driveUrl })));
	}

	return { rows, receiptCell: receiptCellOf(receipts), warnings };
}

/**
 * 領収書欄（5.4）。日付の昇順に、見出しと URL を改行で並べる。1行に URL は1本だけ。
 * 1日に複数回乗ったら URL を複数行並べる
 */
export function receiptCellOf(receipts: { rodeOn: CalendarDate; driveUrl: string }[]): string {
	const sorted = [...receipts].sort((a, b) =>
		a.rodeOn < b.rodeOn ? -1 : a.rodeOn > b.rodeOn ? 1 : 0,
	);
	const lines: string[] = [];
	let current: CalendarDate | null = null;
	for (const receipt of sorted) {
		if (receipt.rodeOn !== current) {
			current = receipt.rodeOn;
			lines.push(dateHeading(current));
		}
		lines.push(receipt.driveUrl);
	}
	return lines.join('\n');
}

/** 行数を照らす（手順5 / N-10）。足りないぶんを挿入する。足りていれば 0 */
export function rowsToInsert(rowCount: number, writableRows: number): number {
	return Math.max(0, rowCount - writableRows);
}

/** 施行日が対象月度に属する案件だけを書く（決定12 / 決定13）。並びは施行日、案件番号、id */
export function inTargetMonth<T extends { serviceDate: CalendarDate }>(
	items: T[],
	target: TargetMonth,
): T[] {
	return items.filter((item) => item.serviceDate.slice(0, 7) === (target as string));
}

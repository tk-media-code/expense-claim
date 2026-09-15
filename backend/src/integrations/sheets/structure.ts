import { AppError } from '../../domain/app-error.js';
import {
	calendarDateOf,
	targetMonthOfFirstDay,
	type CalendarDate,
	type TargetMonth,
} from '../../domain/month.js';
import type { SheetStructure, SubmissionRow, VenueMasterRow } from './client.js';

// Sheets API の応答を読むための純粋な規則。I/O を持たず、実物の応答の形（要求分析 5章の実測）だけを知る。

/** Google スプレッドシートのシリアル値の起点 */
const SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** 日付のシリアル値（2026年8月なら 46235 = 2026-08-01）を暦日にする（7.1） */
export function serialToCalendarDate(serial: number): CalendarDate | null {
	if (!Number.isFinite(serial)) return null;
	const date = new Date(SERIAL_EPOCH_UTC + Math.floor(serial) * 24 * 60 * 60 * 1000);
	return calendarDateOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** A1 の生の値を対象月度にする。数値でない・暦日でない・月初でないなら中止（要件定義 5.5） */
export function targetMonthOfCell(value: unknown): TargetMonth {
	const date = typeof value === 'number' ? serialToCalendarDate(value) : null;
	const month = date ? targetMonthOfFirstDay(date) : null;
	if (!month) throw new AppError('TARGET_MONTH_UNREADABLE');
	return month;
}

/**
 * 7行目のヘッダー（7.3）。A〜J の10列。K（車両）・L（備考）・M（領収書）は6〜7行目の結合セルで、
 * 7行目の値には現れない（実測）。並びが違えば中止する（NF-10）
 */
export const EXPECTED_HEADER = [
	'日付',
	'目的地(会場)',
	'目的',
	'案件名(新郎/新婦)',
	'出発駅',
	'到着駅',
	'往復',
	'金額',
	'タクシー',
	'高速代/駐車場',
] as const;

export function assertHeaderMatches(cells: unknown[]): void {
	const actual = EXPECTED_HEADER.map((_, i) => String(cells[i] ?? '').trim());
	const matches = EXPECTED_HEADER.every((expected, i) => actual[i] === expected);
	if (!matches) throw new AppError('SHEET_FORMAT_CHANGED');
}

export type ProtectedRange = {
	range?: { startRowIndex?: number | null; endRowIndex?: number | null } | null;
	requestingUserCanEdit?: boolean | null;
};

/**
 * 書ける行の範囲を決める（7.2）。requestingUserCanEdit が真の保護範囲のうち、行の範囲を持つものを
 * 書ける範囲とし、グリッドの行数を超えないことを確かめる。決まらなければ中止（要件定義 5.5）
 */
export function writableRangeOf(
	protectedRanges: ProtectedRange[],
	rowCount: number,
): Pick<SheetStructure, 'firstBodyRow' | 'lastBodyRow' | 'writableRows'> {
	const editable = protectedRanges.find(
		(p) =>
			p.requestingUserCanEdit === true &&
			typeof p.range?.startRowIndex === 'number' &&
			typeof p.range.endRowIndex === 'number',
	);
	if (!editable?.range) throw new AppError('WRITABLE_RANGE_UNKNOWN');
	const firstBodyRow = (editable.range.startRowIndex ?? 0) + 1;
	// endRowIndex は排他。グリッドの外へは書けない（要求分析 5.3・実測）
	const lastBodyRow = Math.min(editable.range.endRowIndex ?? 0, rowCount);
	if (lastBodyRow < firstBodyRow) throw new AppError('WRITABLE_RANGE_UNKNOWN');
	return { firstBodyRow, lastBodyRow, writableRows: lastBodyRow - firstBodyRow + 1 };
}

/** 会場マスタ（7.4）。A列がコード、B列が会場名。名前が無い行はコードを名前にする */
export function venueMasterOf(values: unknown[][]): VenueMasterRow[] {
	const rows: VenueMasterRow[] = [];
	for (const row of values) {
		const code = String(row[0] ?? '').trim();
		if (code === '') continue;
		const name = String(row[1] ?? '').trim();
		rows.push({ code, name: name === '' ? code : name });
	}
	return rows;
}

/** `'会場'!$A:$A` のような参照からシート名を取り出す。入力規則の参照先は `=` 始まり */
export function sheetTitleOfReference(reference: string): string | null {
	const m = /^=?'?([^'!]+)'?!/.exec(reference.trim());
	return m?.[1] ?? null;
}

/** A1 記法のシート名。空白や記号を含むので引用する */
export function quoteSheetTitle(title: string): string {
	return `'${title.replace(/'/g, "''")}'`;
}

/** 本文行の列数。A〜M */
export const BODY_COLUMNS = 13;

/**
 * 本文行の矩形（8.2）。書く行 → 値、残りの行 → 全列 ""。J〜L は常に空。
 * M列は結合セルの左上（先頭行）にだけ領収書欄を書き、以降は ""（書いても表示されない。実測）。
 * 矩形1つなら「クリアだけ通った」状態が作れない。決定11（本文行はすべてアプリが持つ）がそのまま出る
 */
export function bodyRectangle(
	rows: SubmissionRow[],
	receiptCell: string,
	writableRows: number,
): (string | number)[][] {
	const cell = (value: string | number | null) => value ?? '';
	const rectangle: (string | number)[][] = [];
	for (let i = 0; i < writableRows; i += 1) {
		const row = rows[i];
		const values: (string | number)[] = row
			? [
					cell(row.A),
					cell(row.B),
					cell(row.C),
					cell(row.D),
					row.E,
					row.F,
					row.G,
					row.H,
					cell(row.I),
					'',
					'',
					'',
				]
			: Array<string>(BODY_COLUMNS - 1).fill('');
		values.push(i === 0 ? receiptCell : '');
		rectangle.push(values);
	}
	return rectangle;
}

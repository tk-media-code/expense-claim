import type { CalendarDate, TargetMonth } from '../../domain/month.js';

// 提出シート（05-integration.md 2.1 / 7章 / 8章）。インターフェースと実装を分ける。
// spreadsheetId もシート名も引数に無い。環境変数から取り、実装の中に閉じる（NF-08 / 8.4）。
// services が見るのは「対象月度を読む」「書ける行の範囲を読む」であって、spreadsheetId ではない

/** 書ける行の範囲（7.2）。25行を決め打ちにしない（NF-09） */
export type SheetStructure = {
	spreadsheetTitle: string;
	/** 本文の先頭行。1 始まり（実測では 8） */
	firstBodyRow: number;
	/** 書ける最終行。1 始まり（実測では 32）。挿入すると伸びる */
	lastBodyRow: number;
	/** 書ける行数（lastBodyRow - firstBodyRow + 1） */
	writableRows: number;
};

export type VenueMasterRow = { code: string; name: string };

/** 提出シートの1行（A〜M）。値は書く形のまま（04-api.md 5.4 の cells） */
export type SubmissionRow = {
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

export interface SheetsClient {
	/** 提出シートの設定（SPREADSHEET_ID / MY_SHEET_NAME）があるか。無ければ叩かず、未設定として扱う */
	readonly configured: boolean;
	/** A1 を UNFORMATTED_VALUE で読み、対象月度にする（7.1）。読めなければ TARGET_MONTH_UNREADABLE */
	readTargetMonth(): Promise<TargetMonth>;
	/** グリッドと保護範囲から書ける行の範囲を決める（7.2）。決まらなければ WRITABLE_RANGE_UNKNOWN */
	readStructure(): Promise<SheetStructure>;
	/** 7行目のヘッダー（7.3）。想定と違えば SHEET_FORMAT_CHANGED */
	assertHeader(): Promise<void>;
	/** B列の入力規則が参照している範囲から会場マスタを読む（7.4） */
	readVenueMaster(): Promise<VenueMasterRow[]>;
	/** 書ける範囲の内側に行を挿入する（8.3）。11-4 */
	insertRows(count: number): Promise<void>;
	/** 本文行の矩形を1回で書く（8.2）。11-4 */
	writeBody(rows: SubmissionRow[], receiptCell: string): Promise<void>;
}

/** 7.1 の帰り値の補助。シリアル値 → 暦日の変換は structure.ts */
export type { CalendarDate };

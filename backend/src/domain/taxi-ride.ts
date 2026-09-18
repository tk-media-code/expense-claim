import type { CalendarDate } from './month.js';

// タクシー乗車と領収書。domain はどの層にも依存しない（01-architecture.md 5.2）。
export type TaxiRide = {
	id: number;
	rodeOn: CalendarDate;
	/** この1回の金額 */
	amount: number;
	receipt: {
		/** アプリが付けた名前 */
		fileName: string;
		/** 提出シートの M列へ書く URL。画面が使うのも URL だけで、driveFileId は返さない（N-08） */
		driveUrl: string;
	};
};

/** 画像と PDF の両方を受け付ける（F-23 / R-13）。File.type で先に弾く（05-integration.md 6.2） */
const EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'application/pdf': 'pdf',
};

export function extensionOf(mimeType: string): string | null {
	return EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

/** 1件あたり数百KB〜数MB（要件定義 9.1）。nginx の client_max_body_size と揃える */
export const RECEIPT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 領収書のファイル名（03-database.md 5.2）。<YYYYMMDD>_<会場コード>_<連番>.<拡張子>。
 * 保管先は1つのフォルダで月ごとに分けないので、日付を先頭に置けば名前順が時系列になる。
 * 連番は同じ案件の領収書の数で採番し、孤児（共有で落ちて残ったファイル）は数に入らない
 */
export function receiptFileName(
	rodeOn: CalendarDate,
	venueCode: string,
	sequence: number,
	extension: string,
): string {
	return `${rodeOn.replace(/-/g, '')}_${venueCode}_${sequence}.${extension}`;
}

// ドライブ（05-integration.md 6章）。インターフェースと実装を分ける（2.1）。
// 保管先フォルダの ID は引数に無い。環境変数から取り、実装の中に閉じる（N-08）。
// 消す呼び出しを持たない（6.3 / 04-api.md 7章）。提出後の正本はドライブにある

export type StoredReceipt = {
	/** 返さない・文面に入れない（N-08）。receipts.drive_file_id に置くだけ */
	fileId: string;
	/** 提出シートの M列へ書く URL（R-15）。webViewLink */
	url: string;
};

export type ReceiptFile = {
	/** アプリが付けた名前（03-database.md 5.2） */
	name: string;
	mimeType: string;
	/** 本文。数百KB〜数MB。ストリームで渡す（6.2） */
	body: ReadableStream<Uint8Array>;
};

export interface DriveClient {
	/** 保管先フォルダの設定（DRIVE_FOLDER_ID）があるか */
	readonly configured: boolean;
	/**
	 * 保存 → 共有の付与（6.1 の②③）。ファイル単位で「リンクを知っている全員が閲覧可」を付ける（F-25 / N-19）。
	 * 途中で失敗したら DRIVE_UPLOAD_FAILED（共有で落ちたか保存で落ちたかを cause に持つ）。
	 * 共有で落ちると孤児のファイルが残るが、これを許す（06-error-handling.md 6.2）
	 */
	store(file: ReceiptFile): Promise<StoredReceipt>;
}

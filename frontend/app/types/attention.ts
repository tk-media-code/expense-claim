// backend/src/domain/attention.ts の写し（契約の写し。types/station.ts と同じ理由）
export type AttentionKind =
	| 'mail_parse_failed'
	| 'venue_code_unknown'
	| 'sheet_unreachable'
	| 'drive_upload_failed'
	| 'rows_inserted'
	| 'alert_send_failed';

export type Attention = {
	id: number;
	kind: AttentionKind;
	/** 本人がそのまま読める日本語の文面 */
	detail: string;
	occurredAt: string;
	/** null なら未確認 */
	checkedAt: string | null;
};

/** 02-screens.md 3.10 の6種。種別を足すときはバックエンドの kind と一緒に足す（06-error-handling.md 1章） */
export const ATTENTION_KIND_LABELS: Record<AttentionKind, string> = {
	mail_parse_failed: 'メールの解析に失敗',
	venue_code_unknown: '会場コードがマスタに無い',
	sheet_unreachable: '提出シートへアクセスできない',
	drive_upload_failed: 'ドライブへの保存に失敗',
	rows_inserted: '行を挿入した',
	alert_send_failed: '提出アラートを送れなかった',
};

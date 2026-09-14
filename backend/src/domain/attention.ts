// 要確認事項。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// アプリが判断できなかったこと・失敗したことの記録（F-33）。7種（06-error-handling.md 3.1）。
// 発生箇所は同期・記録・提出・cron の4つで、外部 API を叩く場所がその4つしか無い。
export const ATTENTION_KINDS = [
	'mail_parse_failed',
	'venue_code_unknown',
	'sheet_unreachable',
	'drive_upload_failed',
	'rows_inserted',
	'month_rolled_over_unsubmitted',
	'alert_send_failed',
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export type Attention = {
	id: number;
	kind: AttentionKind;
	/** 本人がそのまま読める日本語の文面。識別子を入れない（06-error-handling.md 4.2） */
	detail: string;
	occurredAt: Date;
	/** null なら未確認（F-34） */
	checkedAt: Date | null;
};

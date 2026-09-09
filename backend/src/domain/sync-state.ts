// 同期状態。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// last_seen_target_month は「対象月度」だが、ここでは素の文字列で持つ。
// 「月」の3基準を型で分ける仕組み（01-architecture.md 5.4）は、
// 取り違えが実際に起こりうる案件・提出の実装で入れる。
export type SyncState = {
	/** 最後に取り込んだ日時。UTC */
	lastImportedAt: Date | null;
	/** 最後に読んだ提出シートの月度。`YYYY-MM-DD` の月初 */
	lastSeenTargetMonth: string | null;
	/** 最後に提出アラートを送った日。`YYYY-MM-DD` */
	lastAlertSentOn: string | null;
	/** cron が最後に起動した日時。UTC */
	lastCronRunAt: Date | null;
	updatedAt: Date;
};

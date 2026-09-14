import type { TargetMonth } from './month.js';

// 同期状態。domain はどの層にも依存しない（01-architecture.md 5.2）。
export type SyncState = {
	/** 最後に取り込んだ日時。UTC */
	lastImportedAt: Date | null;
	/** 最後に読んだ提出シートの月度。月度切替の検知に使う（F-32） */
	lastSeenTargetMonth: TargetMonth | null;
	/** 最後に提出アラートを送った日。`YYYY-MM-DD` */
	lastAlertSentOn: string | null;
	/** cron が最後に起動した日時。UTC */
	lastCronRunAt: Date | null;
	updatedAt: Date;
};

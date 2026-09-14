import type { ProjectMonth, TargetMonth } from './month.js';
import type { Project } from './project.js';

// ホームの集約（04-api.md 5.1）。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// 月度ごとに束ねて返す。束ねるのは月度の判定であり、サーバーの仕事（04-api.md 3.2）。
// 「施行前」は返さない。施行日と今日を比べれば分かり、表示の強調だけでデータが壊れない。

/** 02-screens.md 3.2 の「提出待ち／提出済み（日時）／これから稼働」 */
export type MonthState = 'due' | 'submitted' | 'upcoming';

export type HomeProject = Pick<
	Project,
	'id' | 'projectNo' | 'serviceDate' | 'venueCode' | 'venueName' | 'coupleName'
> & {
	/** 交通費記録の有無（F-21）。Phase 4-5 で実値になる */
	recorded: boolean;
	/** 記録済みなら区間の金額の合計。未記録なら null */
	totalAmount: number | null;
	/** タクシー乗車の件数。記録済みのときだけ画面に出す */
	taxiCount: number;
};

export type HomeMonth = {
	month: ProjectMonth;
	state: MonthState;
	/** 提出済みなら最新の実行日時（F-30）。Phase 11-7 で実値になる */
	submittedAt: Date | null;
	/** 施行日の昇順、同じ日なら案件番号の昇順（要件定義 5.3） */
	projects: HomeProject[];
};

export type Home = {
	/** 提出シートの A1 が決める対象月度（決定13）。一度も同期していなければ null */
	targetMonth: TargetMonth | null;
	/** 最後に取り込んだ日時。静かな故障に気づく手立て（要件定義 10章） */
	lastImportedAt: Date | null;
	/** 提出アラートの cron が最後に動いた日時（06-error-handling.md 7章） */
	lastCronRunAt: Date | null;
	/** 未確認の要確認事項の件数。Phase 7-2 で実値になる */
	attentionCount: number;
	/** 月度の降順。最大2要素（要件定義 9.2） */
	months: HomeMonth[];
};

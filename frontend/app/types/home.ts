// backend/src/domain/home.ts の写し。別々の Dockerfile でビルドされ、相手のソースを
// import する経路が無いので、契約の写しとして持つ（types/station.ts と同じ理由）。
// 日時は ISO 8601 の UTC 文字列で来る（04-api.md 2.4）。表示のための JST への変換は画面が行う
export type MonthState = 'due' | 'submitted' | 'upcoming';

export type HomeProject = {
	id: number;
	projectNo: string;
	/** YYYY-MM-DD */
	serviceDate: string;
	venueCode: string;
	venueName: string;
	coupleName: string;
	/** 交通費記録の有無（F-21） */
	recorded: boolean;
	/** 記録済みなら区間の金額の合計。未記録なら null */
	totalAmount: number | null;
	taxiCount: number;
};

export type HomeMonth = {
	/** YYYY-MM */
	month: string;
	state: MonthState;
	submittedAt: string | null;
	projects: HomeProject[];
};

export type Home = {
	/** YYYY-MM。一度も同期していなければ null */
	targetMonth: string | null;
	lastImportedAt: string | null;
	lastCronRunAt: string | null;
	attentionCount: number;
	months: HomeMonth[];
};

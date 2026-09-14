import type { CalendarDate, ProjectMonth } from './month.js';

// 案件。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// created_at / updated_at は持たない。障害を追うための列で、業務ロジックは見ない（03-database.md 4.3）。
export type ProjectSource = 'mail' | 'manual';

export type Project = {
	id: number;
	/** 案件番号。どの案件も必ず持つ（F-10）。二重取り込みの鍵（F-08） */
	projectNo: string;
	/** 施行日。月度はここから導出する（決定12） */
	serviceDate: CalendarDate;
	/** 案件の月度。施行日から導出し、サーバーが決める（04-api.md 3.2）。列には持たない（03-database.md 9章） */
	month: ProjectMonth;
	/** 会場コード。外部キーではない（03-database.md 8章） */
	venueCode: string;
	/** 会場名。マスタに無い会場は venues に名前が無いので、実績側に持つ */
	venueName: string;
	/** ご両家名。〇〇様△△様 の形 */
	coupleName: string;
	/** 自動取込／手動追加。API から受け取らない（04-api.md 7章） */
	source: ProjectSource;
};

/** projects の VARCHAR の長さ（03-database.md 5.2）。routes の検証がこれを見る */
export const PROJECT_NO_MAX_LENGTH = 32;
export const COUPLE_NAME_MAX_LENGTH = 255;

/** 案件の詳細に載せる記録の要約（02-screens.md 3.3）。ルート名は表示用で、ルートが消えると null */
export type ProjectRecordSummary = {
	tripType: 'round' | 'one_way';
	/** 区間の金額の合計 */
	total: number;
	outboundRouteName: string | null;
	returnRouteName: string | null;
	recordedAt: Date;
};

/** GET /api/projects/:id（04-api.md 4.4「詳細。記録の要約を含む」） */
export type ProjectDetail = Project & {
	record: ProjectRecordSummary | null;
	/** タクシー乗車の件数。Phase 10 で実値になる */
	taxiCount: number;
};

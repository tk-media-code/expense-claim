// backend/src/domain/project.ts の写し。別々の Dockerfile でビルドされ、相手のソースを
// import する経路が無いので、契約の写しとして持つ（types/station.ts と同じ理由）。
export type ProjectSource = 'mail' | 'manual';

export type Project = {
	id: number;
	/** 案件番号。どの案件も必ず持つ（F-10） */
	projectNo: string;
	/** 施行日。YYYY-MM-DD */
	serviceDate: string;
	/** 案件の月度。YYYY-MM。サーバーが施行日から導出する（04-api.md 3.2） */
	month: string;
	venueCode: string;
	venueName: string;
	coupleName: string;
	source: ProjectSource;
};

/** 追加・修正の本文（04-api.md 4.4）。会場名は会場コードからサーバーが引く */
export type ProjectFormValue = {
	projectNo: string;
	serviceDate: string;
	venueCode: string;
	coupleName: string;
};

/** 案件の詳細に載せる記録の要約（02-screens.md 3.3） */
export type ProjectRecordSummary = {
	tripType: 'round' | 'one_way';
	total: number;
	outboundRouteName: string | null;
	returnRouteName: string | null;
	recordedAt: string;
};

/** GET /api/projects/:id */
export type ProjectDetail = Project & {
	record: ProjectRecordSummary | null;
	taxiCount: number;
};

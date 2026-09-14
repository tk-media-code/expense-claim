// backend/src/domain/segment.ts の写し。別々の Dockerfile でビルドされ、相手のソースを
// import する経路が無いので、契約の写しとして持つ（types/station.ts と同じ理由）。
export type Segment = {
	id: number;
	fromStationId: number;
	fromStationName: string;
	toStationId: number;
	toStationName: string;
	/** 片道運賃（円）。複数のルートで共有され、直すと使っている全ルートに効く（決定18） */
	oneWayFare: number;
	/** この区間を使っているルートの数。0 のときだけ駅の差し替えと削除ができる（決定22） */
	routeCount: number;
};

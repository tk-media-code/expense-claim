// backend/src/domain/route.ts の写し。別々の Dockerfile でビルドされ、相手のソースを
// import する経路が無いので、契約の写しとして持つ（types/station.ts と同じ理由）。
export type RouteLeg = {
	/** ルート内の順序。1 始まり。サーバーが振る（04-api.md 3.2） */
	sortOrder: number;
	segmentId: number;
	fromStationName: string;
	toStationName: string;
	oneWayFare: number;
};

export type Route = {
	id: number;
	venueId: number;
	name: string;
	/** 区間の中身つき。sortOrder の昇順 */
	legs: RouteLeg[];
};

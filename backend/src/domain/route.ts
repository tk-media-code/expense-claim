// ルート。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// 「自宅→会場」の1方向で持つ（決定9）。復路は区間の並びを逆順にし、出発駅と到着駅を
// 入れ替えて使う。並びは segmentIds の配列順からサーバーが振る（04-api.md 3.2）。
export type RouteLeg = {
	/** ルート内の順序。1 始まり */
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

/** routes.name は VARCHAR(100)（03-database.md 5.1）。routes の検証がこれを見る */
export const ROUTE_NAME_MAX_LENGTH = 100;

// 駅。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// created_at / updated_at は持たない。障害を追うための列で、業務ロジックは見ない（03-database.md 4.3）。
export type Station = {
	id: number;
	/** 鉄道会社の略称込み（F-15）。X鉄乙駅 と Y鉄乙駅 は別の駅 */
	name: string;
	/** この駅を出発駅か到着駅にしている区間の数（02-screens.md 3.8）。使われている駅は消せない（決定22） */
	segmentCount: number;
};

/** stations.name は VARCHAR(100)（03-database.md 5.1）。routes の検証がこれを見る */
export const STATION_NAME_MAX_LENGTH = 100;

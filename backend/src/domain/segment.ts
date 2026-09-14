// 区間。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// created_at / updated_at は持たない。障害を追うための列で、業務ロジックは見ない（03-database.md 4.3）。
// 駅名を持つのは、画面が「出発駅名 → 到着駅名」を出すのに駅一覧と突き合わせずに済ませるため
// （02-screens.md 3.8）。書き方は 04-api.md 5.2 の legs（fromStationName / toStationName）と同じ。
export type Segment = {
	id: number;
	fromStationId: number;
	fromStationName: string;
	toStationId: number;
	toStationName: string;
	/** 片道運賃（円）。複数のルートで共有され、直すと使っている全ルートに効く（決定18） */
	oneWayFare: number;
	/** この区間を使っているルートの数（02-screens.md 3.8）。0 でなければ駅の差し替えと削除はできない（決定22） */
	routeCount: number;
};

/**
 * segments.one_way_fare は INT UNSIGNED（03-database.md 5.1）。routes の検証がこれを見る。
 * 上限を越えると DB が ER_WARN_DATA_OUT_OF_RANGE で落として 500 になるので、その前に 422 で弾く
 */
export const ONE_WAY_FARE_MAX = 4_294_967_295;

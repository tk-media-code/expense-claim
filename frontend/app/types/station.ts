// backend/src/domain/station.ts の写し。別々の Dockerfile でビルドされ、相手のソースを
// import する経路が無いので、契約の写しとして持つ（utils/api-error.ts と同じ理由）。
export type Station = {
	id: number;
	/** 鉄道会社の略称込み（F-15）。X鉄乙駅 と Y鉄乙駅 は別の駅 */
	name: string;
	/** この駅を出発駅か到着駅にしている区間の数。0 のときだけ消せる（決定22） */
	segmentCount: number;
};

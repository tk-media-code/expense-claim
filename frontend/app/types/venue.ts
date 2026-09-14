// backend/src/domain/venue.ts の写し。別々の Dockerfile でビルドされ、相手のソースを
// import する経路が無いので、契約の写しとして持つ（types/station.ts と同じ理由）。
export type VenueSource = 'master' | 'manual';

export type VenueRoute = {
	id: number;
	name: string;
	/** 使う区間の数。乗り換え無しなら1 */
	segmentCount: number;
	/** 区間の片道運賃の合計（円） */
	oneWayTotal: number;
};

export type Venue = {
	id: number;
	code: string;
	name: string;
	/** マスタ由来（F-13）／自分で追加（F-14） */
	source: VenueSource;
	/** 0本の会場は記録できない（02-screens.md 4.3）。目立たせる */
	routes: VenueRoute[];
};

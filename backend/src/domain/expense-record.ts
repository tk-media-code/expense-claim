import type { Project } from './project.js';
import type { Route, RouteLeg } from './route.js';
import type { TaxiRide } from './taxi-ride.js';

// 交通費記録。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// 提出行の正本は legs である（03-database.md 7章）。加工は記録時に済ませ、提出時には何もしない。
// 往復の ×2 と復路の反転は要件が定めた規則で（要件定義 5.3 / 決定9）、正本を作る規則を
// ここ1か所に置く。クライアントは金額を1円も送らない（04-api.md 5.3）。

/** 提出シートの G列。往路と復路が同じルートなら全行 `往復`、別なら全行 `片道` */
export type TripType = 'round' | 'one_way';

export type ExpenseRecordLeg = {
	/** 提出シートに書く順。1 始まり */
	sortOrder: number;
	/** 記録時点の駅名（E列）。駅への参照ではない */
	fromStationName: string;
	/** 記録時点の駅名（F列） */
	toStationName: string;
	/** H列へ無加工で書く額。往復なら片道運賃 ×2 */
	amount: number;
};

export type ExpenseRecord = {
	id: number;
	tripType: TripType;
	/** 表示用。ルートが消えると null（03-database.md 6.2 SET NULL） */
	outboundRouteId: number | null;
	returnRouteId: number | null;
	recordedAt: Date;
	legs: ExpenseRecordLeg[];
};

/** 記録画面が開いた時点で埋まっているべき値（02-screens.md 3.5 / 04-api.md 5.2） */
export type ExpenseRecordDefaults = {
	tripType: TripType;
	outboundRouteId: number | null;
	returnRouteId: number | null;
	legs: ExpenseRecordLeg[];
};

/** GET /api/projects/:id/expense-record の集約（04-api.md 5.2） */
export type ExpenseRecordView = {
	project: Pick<Project, 'id' | 'serviceDate' | 'venueCode' | 'venueName' | 'coupleName'>;
	routes: Route[];
	defaults: ExpenseRecordDefaults;
	record: ExpenseRecord | null;
	/** 領収書つきの乗車。乗車は交通費記録と独立している（04-api.md 4.6） */
	taxiRides: TaxiRide[];
};

/**
 * 提出行を組み立てる（要件定義 5.3 / 03-database.md 7.2）。
 * 往復なら往路の区間ごとに1行で、金額は片道運賃 ×2。
 * 片道なら往路の区間を並べ、続けて復路のルートを反転（逆順にし、出発駅と到着駅を入れ替える）して並べる。
 * 復路は「自宅→会場」の向きで登録されたルートを反転して使う（決定9）。運賃は片道運賃そのまま
 */
export function buildLegs(
	tripType: TripType,
	outbound: RouteLeg[],
	inbound: RouteLeg[],
): ExpenseRecordLeg[] {
	const rows =
		tripType === 'round'
			? outbound.map((leg) => ({
					fromStationName: leg.fromStationName,
					toStationName: leg.toStationName,
					amount: leg.oneWayFare * 2,
				}))
			: [
					...outbound.map((leg) => ({
						fromStationName: leg.fromStationName,
						toStationName: leg.toStationName,
						amount: leg.oneWayFare,
					})),
					...[...inbound].reverse().map((leg) => ({
						fromStationName: leg.toStationName,
						toStationName: leg.fromStationName,
						amount: leg.oneWayFare,
					})),
				];
	return rows.map((row, index) => ({ sortOrder: index + 1, ...row }));
}

/**
 * 記録画面の既定値（02-screens.md 4.3 / 04-api.md 5.2）。
 * ルートが1本ならそれが選択済みで開き（2手が成立する）、複数なら未選択。0本なら記録できない。
 * 往復か片道かは既定で `往復`。実測では全行が往復で、片道はまだ一度も起きていない
 */
export function defaultsFor(routes: Route[]): ExpenseRecordDefaults {
	const only = routes.length === 1 ? routes[0] : undefined;
	return {
		tripType: 'round',
		outboundRouteId: only?.id ?? null,
		returnRouteId: only?.id ?? null,
		legs: only ? buildLegs('round', only.legs, only.legs) : [],
	};
}

/** 区間の金額の合計。ホームと詳細の「合計額」（02-screens.md 3.2 / 3.3） */
export function totalOf(legs: ExpenseRecordLeg[]): number {
	return legs.reduce((sum, leg) => sum + leg.amount, 0);
}

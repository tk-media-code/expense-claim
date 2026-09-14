import type { Route, RouteLeg } from '~/types/route';

// backend/src/domain/expense-record.ts の写し。別々の Dockerfile でビルドされ、相手のソースを
// import する経路が無いので、契約の写しとして持つ（types/station.ts と同じ理由）。
export type TripType = 'round' | 'one_way';

export type ExpenseRecordLeg = {
	sortOrder: number;
	fromStationName: string;
	toStationName: string;
	/** H列へ無加工で書く額。往復なら片道運賃 ×2 */
	amount: number;
};

export type ExpenseRecord = {
	id: number;
	tripType: TripType;
	outboundRouteId: number | null;
	returnRouteId: number | null;
	recordedAt: string;
	legs: ExpenseRecordLeg[];
};

export type ExpenseRecordDefaults = {
	tripType: TripType;
	outboundRouteId: number | null;
	returnRouteId: number | null;
	legs: ExpenseRecordLeg[];
};

/** GET /api/projects/:id/expense-record（04-api.md 5.2） */
export type ExpenseRecordView = {
	project: {
		id: number;
		serviceDate: string;
		venueCode: string;
		venueName: string;
		coupleName: string;
	};
	routes: Route[];
	defaults: ExpenseRecordDefaults;
	record: ExpenseRecord | null;
	taxiRides: unknown[];
};

/**
 * 表示のための区間の再計算（04-api.md 3.2「クライアントが決めてよい」の最後の1つ）。
 * ルートを選び直すたびにサーバーへ聞けば往復が増える。規則はサーバーと同じで、
 * 食い違えば保存した直後に画面で分かる（PUT の応答が保存された区間をそのまま返す）
 */
export function previewLegs(
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
					...[...inbound]
						.reverse()
						.map((leg) => ({
							fromStationName: leg.toStationName,
							toStationName: leg.fromStationName,
							amount: leg.oneWayFare,
						})),
				];
	return rows.map((row, index) => ({ sortOrder: index + 1, ...row }));
}

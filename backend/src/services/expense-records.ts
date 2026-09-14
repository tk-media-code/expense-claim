import { AppError } from '../domain/app-error.js';
import {
	buildLegs,
	defaultsFor,
	type ExpenseRecord,
	type ExpenseRecordView,
	type TripType,
} from '../domain/expense-record.js';
import type { Route } from '../domain/route.js';
import type { ExpenseRecordsRepository } from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { RoutesRepository } from '../repositories/routes.js';
import type { TaxiRidesRepository } from '../repositories/taxi-rides.js';
import type { VenuesRepository } from '../repositories/venues.js';

/** PUT の本文（04-api.md 5.3）。区間も駅名も金額も送らない。送るのは選んだルートだけ */
export type ExpenseRecordSaveInput = {
	tripType: TripType;
	outboundRouteId: number;
	/** 片道のときだけ要る。往復なら往路と同じになる（決定9） */
	returnRouteId?: number;
};

// 記録の集約と保存（04-api.md 4.5）。2手の経路の2手目で、開いた時点で保存できる状態を返す。
export function createExpenseRecordsService(
	repository: ExpenseRecordsRepository,
	projectsRepository: ProjectsRepository,
	venuesRepository: VenuesRepository,
	routesRepository: RoutesRepository,
	taxiRidesRepository: TaxiRidesRepository,
) {
	// 会場のルート。案件は会場コードで会場を指し（03-database.md 8章）、マスタに無いコードなら
	// 会場が無くルートも0本。画面は「ルートが登録されていません」と会場とルートへ導く（02-screens.md 4.3）
	async function routesOf(venueCode: string): Promise<Route[]> {
		const venue = await venuesRepository.findByCode(venueCode);
		return venue ? routesRepository.listByVenueId(venue.id) : [];
	}

	return {
		async get(projectId: number): Promise<ExpenseRecordView> {
			const project = await projectsRepository.findById(projectId);
			if (project === null) throw new AppError('NOT_FOUND');
			const [routes, record, taxiRides] = await Promise.all([
				routesOf(project.venueCode),
				repository.findByProjectId(projectId),
				taxiRidesRepository.listByProjectId(projectId),
			]);
			return {
				project: {
					id: project.id,
					serviceDate: project.serviceDate,
					venueCode: project.venueCode,
					venueName: project.venueName,
					coupleName: project.coupleName,
				},
				routes,
				// record が null でないときは、そちらが defaults に優先する（5.2）。それは画面の判断
				defaults: defaultsFor(routes),
				record,
				taxiRides,
			};
		},

		// 提出行の正本を作る規則をここ1か所に置く（04-api.md 3.2 / 5.3）。
		// 金額はルートの登録運賃から決まり、人の判断が入らない（F-20）
		async save(projectId: number, input: ExpenseRecordSaveInput): Promise<ExpenseRecord> {
			const project = await projectsRepository.findById(projectId);
			if (project === null) throw new AppError('NOT_FOUND');

			// 選べるのは会場に紐づくルートだけ（02-screens.md 3.5）。他の会場のルートは本文の値の問題なので 422
			const routes = await routesOf(project.venueCode);
			const outbound = routes.find((route) => route.id === input.outboundRouteId);
			if (!outbound) throw new AppError('INVALID_VALUE', { message: '往路ルートが見つかりません' });

			let inbound: Route;
			if (input.tripType === 'round') {
				// 往復なら復路は往路と同じ（決定9）。違うルートを送られたら黙って無視せず弾く
				if (input.returnRouteId !== undefined && input.returnRouteId !== outbound.id) {
					throw new AppError('INVALID_VALUE', {
						message:
							'往復のときは復路も往路と同じルートになります。違うルートなら片道を選んでください',
					});
				}
				inbound = outbound;
			} else {
				if (input.returnRouteId === undefined) {
					throw new AppError('INVALID_VALUE', { message: '復路ルートを選んでください' });
				}
				const found = routes.find((route) => route.id === input.returnRouteId);
				if (!found) throw new AppError('INVALID_VALUE', { message: '復路ルートが見つかりません' });
				inbound = found;
			}

			return repository.save(projectId, {
				tripType: input.tripType,
				outboundRouteId: outbound.id,
				returnRouteId: inbound.id,
				legs: buildLegs(input.tripType, outbound.legs, inbound.legs),
			});
		},
	};
}

export type ExpenseRecordsService = ReturnType<typeof createExpenseRecordsService>;

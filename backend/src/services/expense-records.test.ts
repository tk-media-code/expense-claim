import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import type { ExpenseRecord } from '../domain/expense-record.js';
import { parseCalendarDate, type CalendarDate } from '../domain/month.js';
import type { Project } from '../domain/project.js';
import type { Route, RouteLeg } from '../domain/route.js';
import type { ExpenseRecordsRepository } from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { RoutesRepository } from '../repositories/routes.js';
import type { VenuesRepository } from '../repositories/venues.js';
import { createExpenseRecordsService } from './expense-records.js';

// services は repository のインターフェースだけを見る（01-architecture.md 5.2）ので、偽物で足りる。
// 要件定義 5.6 の架空の例（会場 AAA は乙駅乗換1本、BBB は丁駅乗換と戊駅直通の2本）
function leg(sortOrder: number, from: string, to: string, fare: number): RouteLeg {
	return {
		sortOrder,
		segmentId: sortOrder,
		fromStationName: from,
		toStationName: to,
		oneWayFare: fare,
	};
}
const viaOtsu: Route = {
	id: 1,
	venueId: 1,
	name: '乙駅乗換',
	legs: [leg(1, 'X鉄甲駅', 'X鉄乙駅', 320), leg(2, 'Y鉄乙駅', 'Y鉄丙駅', 210)],
};
const viaTei: Route = {
	id: 2,
	venueId: 2,
	name: '丁駅乗換',
	legs: [leg(1, 'X鉄甲駅', 'X鉄丁駅', 380), leg(2, 'Y鉄丁駅', 'Y鉄戊駅', 210)],
};
const direct: Route = {
	id: 3,
	venueId: 2,
	name: '戊駅直通',
	legs: [leg(1, 'X鉄甲駅', 'Z鉄戊駅', 520)],
};

function project(id: number, venueCode: string): Project {
	const serviceDate = parseCalendarDate('2026-09-05') as CalendarDate;
	return {
		id,
		projectNo: `10000000${id}`,
		serviceDate,
		month: '2026-09' as Project['month'],
		venueCode,
		venueName: `${venueCode}会場`,
		coupleName: '〇〇様△△様',
		source: 'mail',
	};
}
const atAAA = project(1, 'AAA');
const atBBB = project(2, 'BBB');
const atEEE = project(5, 'EEE');

function createFakes(options: { record?: ExpenseRecord | null } = {}) {
	const findByProjectId = vi.fn<ExpenseRecordsRepository['findByProjectId']>(() =>
		Promise.resolve(options.record ?? null),
	);
	const save = vi.fn<ExpenseRecordsRepository['save']>((_projectId, input) =>
		Promise.resolve({
			id: 12,
			tripType: input.tripType,
			outboundRouteId: input.outboundRouteId,
			returnRouteId: input.returnRouteId,
			recordedAt: new Date('2026-09-05T10:03:00Z'),
			legs: input.legs,
		}),
	);
	const repository = { findByProjectId, save } as unknown as ExpenseRecordsRepository;
	const projectsRepository = {
		findById: vi.fn<ProjectsRepository['findById']>((id) =>
			Promise.resolve([atAAA, atBBB, atEEE].find((p) => p.id === id) ?? null),
		),
	} as unknown as ProjectsRepository;
	const venuesRepository = {
		findByCode: vi.fn<VenuesRepository['findByCode']>((code) =>
			Promise.resolve(
				code === 'AAA'
					? { id: 1, code: 'AAA', name: '甲ホール', source: 'master' }
					: code === 'BBB'
						? { id: 2, code: 'BBB', name: '乙迎賓館', source: 'master' }
						: null,
			),
		),
	} as unknown as VenuesRepository;
	const routesRepository = {
		listByVenueId: vi.fn<RoutesRepository['listByVenueId']>((venueId) =>
			Promise.resolve(venueId === 1 ? [viaOtsu] : venueId === 2 ? [viaTei, direct] : []),
		),
	} as unknown as RoutesRepository;
	return {
		service: createExpenseRecordsService(
			repository,
			projectsRepository,
			venuesRepository,
			routesRepository,
		),
		save,
	};
}

function failure(promise: Promise<unknown>): Promise<AppError | null> {
	return promise.then(
		() => null,
		(cause: unknown) => (cause instanceof AppError ? cause : null),
	);
}

describe('expense-records service', () => {
	describe('get', () => {
		// 04-api.md 5.2。defaults が2手を成立させている
		it('ルートが1本の会場は選択済みで、往復の金額まで入った既定値を返す', async () => {
			const { service } = createFakes();
			const view = await service.get(1);
			expect(view.project).toEqual({
				id: 1,
				serviceDate: '2026-09-05',
				venueCode: 'AAA',
				venueName: 'AAA会場',
				coupleName: '〇〇様△△様',
			});
			expect(view.routes).toEqual([viaOtsu]);
			expect(view.defaults).toEqual({
				tripType: 'round',
				outboundRouteId: 1,
				returnRouteId: 1,
				legs: [
					{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
					{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
				],
			});
			expect(view.record).toBeNull();
			expect(view.taxiRides).toEqual([]);
		});

		it('ルートが2本の会場は未選択で返す', async () => {
			const { service } = createFakes();
			const view = await service.get(2);
			expect(view.routes.map((r) => r.id)).toEqual([2, 3]);
			expect(view.defaults.outboundRouteId).toBeNull();
		});

		// 03-database.md 8章。マスタに無いコードの案件は会場が無く、ルートも0本
		it('会場が無い案件は routes が空で、既定値は未選択', async () => {
			const { service } = createFakes();
			const view = await service.get(5);
			expect(view.routes).toEqual([]);
			expect(view.defaults.outboundRouteId).toBeNull();
		});

		it('無い案件なら NOT_FOUND を投げる', async () => {
			const { service } = createFakes();
			expect((await failure(service.get(99)))?.code).toBe('NOT_FOUND');
		});
	});

	describe('save', () => {
		// 2手の2手目。既定値のまま保存する
		it('往復なら往路の区間を ×2 した行を組み立てて保存する', async () => {
			const { service, save } = createFakes();
			const saved = await service.save(1, { tripType: 'round', outboundRouteId: 1 });
			expect(save).toHaveBeenCalledWith(1, {
				tripType: 'round',
				outboundRouteId: 1,
				returnRouteId: 1,
				legs: [
					{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
					{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
				],
			});
			expect(saved.id).toBe(12);
		});

		// 要件定義 5.6 の案件 B。往路「丁駅乗換」／復路「戊駅直通」で片道3行
		it('片道なら復路を反転して続け、片道運賃のまま保存する', async () => {
			const { service, save } = createFakes();
			await service.save(2, { tripType: 'one_way', outboundRouteId: 2, returnRouteId: 3 });
			expect(save).toHaveBeenCalledWith(2, {
				tripType: 'one_way',
				outboundRouteId: 2,
				returnRouteId: 3,
				legs: [
					{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄丁駅', amount: 380 },
					{ sortOrder: 2, fromStationName: 'Y鉄丁駅', toStationName: 'Y鉄戊駅', amount: 210 },
					{ sortOrder: 3, fromStationName: 'Z鉄戊駅', toStationName: 'X鉄甲駅', amount: 520 },
				],
			});
		});

		it('往復で復路に往路と同じルートを送っても通る', async () => {
			const { service, save } = createFakes();
			await service.save(1, { tripType: 'round', outboundRouteId: 1, returnRouteId: 1 });
			expect(save).toHaveBeenCalled();
		});

		it.each<
			[string, number, Parameters<ReturnType<typeof createFakes>['service']['save']>[1], string]
		>([
			[
				'他の会場のルートを往路に',
				1,
				{ tripType: 'round', outboundRouteId: 2 },
				'往路ルートが見つかりません',
			],
			[
				'片道で復路が無い',
				2,
				{ tripType: 'one_way', outboundRouteId: 2 },
				'復路ルートを選んでください',
			],
			[
				'片道で復路が他の会場',
				2,
				{ tripType: 'one_way', outboundRouteId: 2, returnRouteId: 1 },
				'復路ルートが見つかりません',
			],
			[
				'往復で復路が違う',
				2,
				{ tripType: 'round', outboundRouteId: 2, returnRouteId: 3 },
				'往復のときは復路も往路と同じルートになります。違うルートなら片道を選んでください',
			],
		])('%s なら INVALID_VALUE を投げ、保存しない', async (_label, projectId, input, message) => {
			const { service, save } = createFakes();
			const error = await failure(service.save(projectId, input));
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe(message);
			expect(save).not.toHaveBeenCalled();
		});

		it('無い案件なら NOT_FOUND を投げる', async () => {
			const { service } = createFakes();
			expect(
				(await failure(service.save(99, { tripType: 'round', outboundRouteId: 1 })))?.code,
			).toBe('NOT_FOUND');
		});
	});
});

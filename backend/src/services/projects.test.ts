import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import { parseCalendarDate, type CalendarDate } from '../domain/month.js';
import type { Project } from '../domain/project.js';
import type { ExpenseRecord } from '../domain/expense-record.js';
import type { ExpenseRecordsRepository } from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { RoutesRepository } from '../repositories/routes.js';
import type { TaxiRidesRepository } from '../repositories/taxi-rides.js';
import type { VenuesRepository } from '../repositories/venues.js';
import { createProjectsService } from './projects.js';

// services は repository のインターフェースだけを見る（01-architecture.md 5.2）ので、偽物で足りる。
// 案件番号・会場・ご両家名は架空の値だけを使う（公開リポジトリ）
function date(value: string): CalendarDate {
	const parsed = parseCalendarDate(value);
	if (!parsed) throw new Error(`暦日として読めない: ${value}`);
	return parsed;
}

const existing: Project = {
	id: 1,
	projectNo: '100000001',
	serviceDate: date('2026-09-05'),
	month: '2026-09' as Project['month'],
	venueCode: 'AAA',
	venueName: '甲ホール',
	coupleName: '〇〇様△△様',
	source: 'mail',
};

function createFakes(
	options: {
		projects?: Project[];
		duplicatedId?: number | null;
		record?: ExpenseRecord | null;
	} = {},
) {
	const findById = vi.fn<ProjectsRepository['findById']>((id) =>
		Promise.resolve(options.projects?.find((project) => project.id === id) ?? null),
	);
	const findIdByProjectNo = vi.fn<ProjectsRepository['findIdByProjectNo']>(() =>
		Promise.resolve(options.duplicatedId ?? null),
	);
	const create = vi.fn<ProjectsRepository['create']>((input) =>
		Promise.resolve({ id: 10, ...input, month: '2026-09' as Project['month'] }),
	);
	const update = vi.fn<ProjectsRepository['update']>((id, patch) =>
		Promise.resolve({ ...existing, id, ...patch } as Project),
	);
	const remove = vi.fn<ProjectsRepository['remove']>(() => Promise.resolve());
	const listFrom = vi.fn<ProjectsRepository['listFrom']>(() => Promise.resolve([]));
	const listInMonth = vi.fn<ProjectsRepository['listInMonth']>(() => Promise.resolve([]));
	const listBefore = vi.fn<ProjectsRepository['listBefore']>(() => Promise.resolve([]));
	const deleteSubmittedBefore = vi.fn<ProjectsRepository['deleteSubmittedBefore']>(() =>
		Promise.resolve(0),
	);
	const repository: ProjectsRepository = {
		findById,
		listFrom,
		listInMonth,
		listBefore,
		deleteSubmittedBefore,
		findIdByProjectNo,
		create,
		update,
		remove,
	};

	const venuesRepository = {
		findByCode: vi.fn<VenuesRepository['findByCode']>((code) =>
			Promise.resolve(
				code === 'AAA' ? { id: 1, code: 'AAA', name: '甲ホール', source: 'master' } : null,
			),
		),
	} as unknown as VenuesRepository;

	const expenseRecordsRepository = {
		findByProjectId: vi.fn<ExpenseRecordsRepository['findByProjectId']>(() =>
			Promise.resolve(options.record ?? null),
		),
	} as unknown as ExpenseRecordsRepository;
	const routesRepository = {
		findById: vi.fn<RoutesRepository['findById']>((id) =>
			Promise.resolve(id === 1 ? { id: 1, venueId: 1, name: '乙駅乗換', legs: [] } : null),
		),
	} as unknown as RoutesRepository;

	const taxiRidesRepository = {
		countByProjectId: vi.fn<TaxiRidesRepository['countByProjectId']>(() => Promise.resolve(0)),
	} as unknown as TaxiRidesRepository;
	return {
		service: createProjectsService(
			repository,
			venuesRepository,
			expenseRecordsRepository,
			routesRepository,
			taxiRidesRepository,
		),
		create,
		update,
		remove,
	};
}

function failure(promise: Promise<unknown>): Promise<AppError | null> {
	return promise.then(
		() => null,
		(cause: unknown) => (cause instanceof AppError ? cause : null),
	);
}

const input = {
	projectNo: '100000002',
	serviceDate: date('2026-09-05'),
	venueCode: 'AAA',
	coupleName: '□□様◇◇様',
};

describe('projects service', () => {
	it('get は無ければ NOT_FOUND を投げ、未記録なら record が null', async () => {
		const { service } = createFakes({ projects: [existing] });
		await expect(service.get(1)).resolves.toEqual({ ...existing, record: null, taxiCount: 0 });
		expect((await failure(service.get(2)))?.code).toBe('NOT_FOUND');
	});

	// 02-screens.md 3.3 の記録の要約。ルート名は表示用で、消えたルート（SET NULL）は null のまま
	it('get は記録の要約（合計・ルート名）を添える', async () => {
		const { service } = createFakes({
			projects: [existing],
			record: {
				id: 12,
				tripType: 'one_way',
				outboundRouteId: 1,
				returnRouteId: null,
				recordedAt: new Date('2026-09-05T10:03:00Z'),
				legs: [
					{ sortOrder: 1, fromStationName: 'a', toStationName: 'b', amount: 380 },
					{ sortOrder: 2, fromStationName: 'b', toStationName: 'a', amount: 520 },
				],
			},
		});
		await expect(service.get(1)).resolves.toMatchObject({
			record: {
				tripType: 'one_way',
				total: 900,
				outboundRouteName: '乙駅乗換',
				returnRouteName: null,
				recordedAt: new Date('2026-09-05T10:03:00Z'),
			},
		});
	});

	describe('create', () => {
		// F-10 / 04-api.md 4.4。source は manual 固定。会場名は会場コードから引く（3.3）
		it('会場名を引き、source を manual で固定して登録する', async () => {
			const { service, create } = createFakes();
			const created = await service.create(input);
			expect(created).toMatchObject({ id: 10, venueName: '甲ホール', source: 'manual' });
			expect(create).toHaveBeenCalledWith({ ...input, venueName: '甲ホール', source: 'manual' });
		});

		it('案件番号が既にあれば PROJECT_NO_DUPLICATED を投げ、登録しない', async () => {
			const { service, create } = createFakes({ duplicatedId: 5 });
			expect((await failure(service.create(input)))?.code).toBe('PROJECT_NO_DUPLICATED');
			expect(create).not.toHaveBeenCalled();
		});

		// 会場は会場一覧から選ぶ（02-screens.md 3.4）。無いコードは本文の値の問題なので 422
		it('会場が無ければ INVALID_VALUE を投げ、登録しない', async () => {
			const { service, create } = createFakes();
			const error = await failure(service.create({ ...input, venueCode: 'ZZZ' }));
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe('会場が見つかりません');
			expect(create).not.toHaveBeenCalled();
		});
	});

	describe('update', () => {
		it('無い案件なら NOT_FOUND を投げる', async () => {
			const { service, update } = createFakes();
			expect((await failure(service.update(9, { coupleName: 'a' })))?.code).toBe('NOT_FOUND');
			expect(update).not.toHaveBeenCalled();
		});

		// 04-api.md 4.4。施行日を直すと所属月度が変わる。月度は導出なので patch に施行日を渡すだけ
		it('送られた項目だけを直し、会場コードを送れば会場名も連動する', async () => {
			const { service, update } = createFakes({ projects: [existing] });
			await service.update(1, { serviceDate: date('2026-10-03'), venueCode: 'AAA' });
			expect(update).toHaveBeenCalledWith(1, {
				serviceDate: '2026-10-03',
				venueCode: 'AAA',
				venueName: '甲ホール',
			});
		});

		it('自分と同じ案件番号なら重複としない', async () => {
			const { service, update } = createFakes({ projects: [existing], duplicatedId: 1 });
			await service.update(1, { projectNo: '100000001' });
			expect(update).toHaveBeenCalled();
		});

		it('他の案件と同じ案件番号なら PROJECT_NO_DUPLICATED を投げる', async () => {
			const { service, update } = createFakes({ projects: [existing], duplicatedId: 2 });
			expect((await failure(service.update(1, { projectNo: '100000002' })))?.code).toBe(
				'PROJECT_NO_DUPLICATED',
			);
			expect(update).not.toHaveBeenCalled();
		});
	});

	describe('remove', () => {
		it('あれば消し、無ければ NOT_FOUND を投げる', async () => {
			const { service, remove } = createFakes({ projects: [existing] });
			await service.remove(1);
			expect(remove).toHaveBeenCalledWith(1);
			expect((await failure(service.remove(2)))?.code).toBe('NOT_FOUND');
		});
	});
});

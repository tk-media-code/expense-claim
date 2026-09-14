import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import type { Route } from '../domain/route.js';
import type { Segment } from '../domain/segment.js';
import type { Venue } from '../domain/venue.js';
import type { RoutesRepository } from '../repositories/routes.js';
import type { SegmentsRepository } from '../repositories/segments.js';
import type { VenuesRepository } from '../repositories/venues.js';
import { createRoutesService } from './routes.js';

// services は repository のインターフェースだけを見る（01-architecture.md 5.2）ので、偽物で足りる。
const venue: Venue = { id: 1, code: 'AAA', name: '甲ホール', source: 'master', routes: [] };
const xy: Segment = {
	id: 1,
	fromStationId: 1,
	fromStationName: 'X鉄甲駅',
	toStationId: 2,
	toStationName: 'X鉄乙駅',
	oneWayFare: 320,
	routeCount: 0,
};
const yz: Segment = { ...xy, id: 2, fromStationId: 3, toStationId: 4, oneWayFare: 210 };

const existing: Route = {
	id: 10,
	venueId: 1,
	name: '乙駅乗換',
	legs: [
		{
			sortOrder: 1,
			segmentId: 1,
			fromStationName: 'X鉄甲駅',
			toStationName: 'X鉄乙駅',
			oneWayFare: 320,
		},
	],
};

function createFakes(
	options: { routes?: Route[]; venues?: Venue[]; segments?: Segment[]; duplicatedId?: number } = {},
) {
	const findById = vi.fn<RoutesRepository['findById']>((id) =>
		Promise.resolve(options.routes?.find((route) => route.id === id) ?? null),
	);
	const findIdByVenueAndName = vi.fn<RoutesRepository['findIdByVenueAndName']>(() =>
		Promise.resolve(options.duplicatedId ?? null),
	);
	const create = vi.fn<RoutesRepository['create']>((input) =>
		Promise.resolve({ id: 11, venueId: input.venueId, name: input.name, legs: [] }),
	);
	const update = vi.fn<RoutesRepository['update']>((id, input) =>
		Promise.resolve({ id, venueId: input.venueId, name: input.name, legs: [] }),
	);
	const remove = vi.fn<RoutesRepository['remove']>(() => Promise.resolve());
	const listByVenueId = vi.fn<RoutesRepository['listByVenueId']>(() => Promise.resolve([]));
	const repository: RoutesRepository = {
		findById,
		listByVenueId,
		findIdByVenueAndName,
		create,
		update,
		remove,
	};

	const venues = options.venues ?? [venue];
	const venuesRepository = {
		findById: vi.fn<VenuesRepository['findById']>((id) =>
			Promise.resolve(venues.find((v) => v.id === id) ?? null),
		),
	} as unknown as VenuesRepository;
	const segments = options.segments ?? [xy, yz];
	const segmentsRepository = {
		findById: vi.fn<SegmentsRepository['findById']>((id) =>
			Promise.resolve(segments.find((s) => s.id === id) ?? null),
		),
	} as unknown as SegmentsRepository;

	const service = createRoutesService(repository, venuesRepository, segmentsRepository);
	return { service, create, update, remove };
}

function failure(promise: Promise<unknown>): Promise<AppError | null> {
	return promise.then(
		() => null,
		(cause: unknown) => (cause instanceof AppError ? cause : null),
	);
}

const input = { venueId: 1, name: '乙駅乗換', segmentIds: [1, 2] };

describe('routes service', () => {
	describe('get', () => {
		it('あれば区間の中身つきで返し、無ければ NOT_FOUND を投げる', async () => {
			const { service } = createFakes({ routes: [existing] });
			await expect(service.get(10)).resolves.toBe(existing);
			expect((await failure(service.get(99)))?.code).toBe('NOT_FOUND');
		});
	});

	describe('create', () => {
		it('会場と区間があり、同じ名前が無ければ登録する', async () => {
			const { service, create } = createFakes();
			const created = await service.create(input);
			expect(created).toMatchObject({ id: 11, name: '乙駅乗換' });
			expect(create).toHaveBeenCalledWith(input);
		});

		// FK をアプリ側検証の代わりにしない（03-database.md 10.2）。本文の値の問題なので 422
		it('会場が無ければ INVALID_VALUE を投げ、登録しない', async () => {
			const { service, create } = createFakes({ venues: [] });
			const error = await failure(service.create(input));
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe('会場が見つかりません');
			expect(create).not.toHaveBeenCalled();
		});

		it('区間が1つでも無ければ INVALID_VALUE を投げ、登録しない', async () => {
			const { service, create } = createFakes({ segments: [xy] });
			const error = await failure(service.create(input));
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe('区間が見つかりません');
			expect(create).not.toHaveBeenCalled();
		});

		// 03-database.md 5.1。同じ会場に同じ名前のルートを2本持たせない
		it('同じ会場に同じ名前があれば ROUTE_NAME_DUPLICATED を投げる', async () => {
			const { service, create } = createFakes({ duplicatedId: 10 });
			expect((await failure(service.create(input)))?.code).toBe('ROUTE_NAME_DUPLICATED');
			expect(create).not.toHaveBeenCalled();
		});
	});

	describe('update', () => {
		it('無いルートなら NOT_FOUND を投げる', async () => {
			const { service, update } = createFakes();
			expect((await failure(service.update(99, input)))?.code).toBe('NOT_FOUND');
			expect(update).not.toHaveBeenCalled();
		});

		// 04-api.md 4.7。重複の判定からは自分自身を除く
		it('自分自身と同じ名前なら重複としない', async () => {
			const { service, update } = createFakes({ routes: [existing], duplicatedId: 10 });
			await service.update(10, input);
			expect(update).toHaveBeenCalledWith(10, input);
		});

		it('他のルートと同じ名前になれば ROUTE_NAME_DUPLICATED を投げる', async () => {
			const { service, update } = createFakes({ routes: [existing], duplicatedId: 12 });
			expect((await failure(service.update(10, input)))?.code).toBe('ROUTE_NAME_DUPLICATED');
			expect(update).not.toHaveBeenCalled();
		});

		it('区間が無ければ INVALID_VALUE を投げる', async () => {
			const { service, update } = createFakes({ routes: [existing], segments: [] });
			expect((await failure(service.update(10, input)))?.code).toBe('INVALID_VALUE');
			expect(update).not.toHaveBeenCalled();
		});
	});

	describe('remove', () => {
		it('あれば消し、無ければ NOT_FOUND を投げる', async () => {
			const { service, remove } = createFakes({ routes: [existing] });
			await service.remove(10);
			expect(remove).toHaveBeenCalledWith(10);
			expect((await failure(service.remove(99)))?.code).toBe('NOT_FOUND');
		});
	});
});

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import type { Segment } from '../domain/segment.js';
import type { Station } from '../domain/station.js';
import type { SegmentsRepository } from '../repositories/segments.js';
import type { StationsRepository } from '../repositories/stations.js';
import { createSegmentsService } from './segments.js';

// services は repository のインターフェースだけを見る（01-architecture.md 5.2）ので、偽物で足りる。
// モックは変数に持って expect に渡す（メソッド参照のまま渡すと unbound-method に当たる）。
const x: Station = { id: 1, name: 'X鉄甲駅', segmentCount: 0 };
const y: Station = { id: 2, name: 'X鉄乙駅', segmentCount: 0 };

function createFakeRepositories(
	options: {
		segments?: Segment[];
		/** findById が知っている駅。無い id には null を返す */
		stations?: Station[];
		/** findIdByStationPair が返す id。null なら重複無し */
		duplicatedId?: number | null;
	} = {},
) {
	const list = vi.fn<SegmentsRepository['list']>(() => Promise.resolve(options.segments ?? []));
	const findById = vi.fn<SegmentsRepository['findById']>(() => Promise.resolve(null));
	const findIdByStationPair = vi.fn<SegmentsRepository['findIdByStationPair']>(() =>
		Promise.resolve(options.duplicatedId ?? null),
	);
	const create = vi.fn<SegmentsRepository['create']>((input) =>
		Promise.resolve({
			id: 10,
			fromStationId: input.fromStationId,
			fromStationName: 'X鉄甲駅',
			toStationId: input.toStationId,
			toStationName: 'X鉄乙駅',
			oneWayFare: input.oneWayFare,
			routeCount: 0,
		}),
	);
	const repository: SegmentsRepository = { list, findById, findIdByStationPair, create };

	const stations = options.stations ?? [x, y];
	const stationsRepository = {
		findById: vi.fn<StationsRepository['findById']>((id) =>
			Promise.resolve(stations.find((station) => station.id === id) ?? null),
		),
	} as unknown as StationsRepository;

	return { repository, stationsRepository, create, findIdByStationPair };
}

function failure(promise: Promise<unknown>): Promise<AppError | null> {
	return promise.then(
		() => null,
		(cause: unknown) => (cause instanceof AppError ? cause : null),
	);
}

const input = { fromStationId: 1, toStationId: 2, oneWayFare: 320 };

describe('segments service', () => {
	it('list は repository の一覧をそのまま返す', async () => {
		const segments: Segment[] = [
			{
				id: 1,
				fromStationId: 1,
				fromStationName: 'X鉄甲駅',
				toStationId: 2,
				toStationName: 'X鉄乙駅',
				oneWayFare: 320,
				routeCount: 2,
			},
		];
		const { repository, stationsRepository } = createFakeRepositories({ segments });
		await expect(createSegmentsService(repository, stationsRepository).list()).resolves.toBe(
			segments,
		);
	});

	describe('create', () => {
		it('駅が両方あり、同じ駅ペアが無ければ登録する', async () => {
			const { repository, stationsRepository, create } = createFakeRepositories();
			const created = await createSegmentsService(repository, stationsRepository).create(input);
			expect(created).toMatchObject({ id: 10, fromStationName: 'X鉄甲駅', routeCount: 0 });
			expect(create).toHaveBeenCalledWith(input);
		});

		// 04-api.md 4.7。本文の駅 id は URL の :id と違い本文の値の問題なので、404 でなく 422 にする。
		// FK をアプリ側検証の代わりにしない（03-database.md 10.2）ので先に読む
		it('出発駅が無ければ INVALID_VALUE を投げ、登録しない', async () => {
			const { repository, stationsRepository, create } = createFakeRepositories({ stations: [y] });
			const error = await failure(
				createSegmentsService(repository, stationsRepository).create(input),
			);
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe('出発駅が見つかりません');
			expect(create).not.toHaveBeenCalled();
		});

		it('到着駅が無ければ INVALID_VALUE を投げ、登録しない', async () => {
			const { repository, stationsRepository, create } = createFakeRepositories({ stations: [x] });
			const error = await failure(
				createSegmentsService(repository, stationsRepository).create(input),
			);
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe('到着駅が見つかりません');
			expect(create).not.toHaveBeenCalled();
		});

		// 決定18。同じ駅ペアに運賃を2つ持たせない。UNIQUE をアプリ側検証の代わりにしない
		it('同じ駅ペアがあれば SEGMENT_DUPLICATED を投げ、登録しない', async () => {
			const { repository, stationsRepository, create, findIdByStationPair } =
				createFakeRepositories({ duplicatedId: 7 });
			const error = await failure(
				createSegmentsService(repository, stationsRepository).create(input),
			);
			expect(error?.code).toBe('SEGMENT_DUPLICATED');
			expect(findIdByStationPair).toHaveBeenCalledWith(1, 2);
			expect(create).not.toHaveBeenCalled();
		});
	});
});

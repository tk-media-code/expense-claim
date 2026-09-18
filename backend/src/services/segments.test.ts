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
		/** findById が知っている区間。無い id には null を返す */
		existing?: Segment[];
		/** findById が知っている駅。無い id には null を返す */
		stations?: Station[];
		/** findIdByStationPair が返す id。null なら重複無し */
		duplicatedId?: number | null;
	} = {},
) {
	const list = vi.fn<SegmentsRepository['list']>(() => Promise.resolve(options.segments ?? []));
	const findById = vi.fn<SegmentsRepository['findById']>((id) =>
		Promise.resolve(options.existing?.find((segment) => segment.id === id) ?? null),
	);
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
	const update = vi.fn<SegmentsRepository['update']>((id, input) =>
		Promise.resolve({
			id,
			fromStationId: input.fromStationId,
			fromStationName: 'X鉄甲駅',
			toStationId: input.toStationId,
			toStationName: 'X鉄乙駅',
			oneWayFare: input.oneWayFare,
			routeCount: 0,
		}),
	);
	const remove = vi.fn<SegmentsRepository['remove']>(() => Promise.resolve());
	const repository: SegmentsRepository = {
		list,
		findById,
		findIdByStationPair,
		create,
		update,
		remove,
	};

	const stations = options.stations ?? [x, y];
	const stationsRepository = {
		findById: vi.fn<StationsRepository['findById']>((id) =>
			Promise.resolve(stations.find((station) => station.id === id) ?? null),
		),
	} as unknown as StationsRepository;

	return { repository, stationsRepository, create, findIdByStationPair, update, remove };
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

		// 決定24。区間は向きを持たない。復路は同じ区間を逆向きに使う
		it('逆向きの駅ペアがあっても SEGMENT_DUPLICATED を投げ、文面で逆向きと言う', async () => {
			const { repository, stationsRepository, create, findIdByStationPair } =
				createFakeRepositories();
			findIdByStationPair.mockImplementation((from, to) =>
				Promise.resolve(from === 2 && to === 1 ? 7 : null),
			);
			const error = await failure(
				createSegmentsService(repository, stationsRepository).create(input),
			);
			expect(error?.code).toBe('SEGMENT_DUPLICATED');
			expect(error?.message).toContain('逆向き');
			expect(findIdByStationPair).toHaveBeenCalledWith(2, 1);
			expect(create).not.toHaveBeenCalled();
		});
	});

	describe('update', () => {
		const z: Station = { id: 3, name: 'X鉄丙駅', segmentCount: 0 };
		const unused: Segment = {
			id: 10,
			fromStationId: 1,
			fromStationName: 'X鉄甲駅',
			toStationId: 2,
			toStationName: 'X鉄乙駅',
			oneWayFare: 320,
			routeCount: 0,
		};
		const inUse: Segment = { ...unused, id: 11, routeCount: 2 };

		it('無い区間なら NOT_FOUND を投げる', async () => {
			const { repository, stationsRepository, update } = createFakeRepositories();
			const error = await failure(
				createSegmentsService(repository, stationsRepository).update(99, { oneWayFare: 330 }),
			);
			expect(error?.code).toBe('NOT_FOUND');
			expect(update).not.toHaveBeenCalled();
		});

		// 決定18 / 決定22。片道運賃は使われていても直せ、使っている全ルートに効く
		it('使用中でも運賃だけなら直せ、駅は現在値のまま渡す', async () => {
			const { repository, stationsRepository, update } = createFakeRepositories({
				existing: [inUse],
			});
			const updated = await createSegmentsService(repository, stationsRepository).update(11, {
				oneWayFare: 330,
			});
			expect(updated.oneWayFare).toBe(330);
			expect(update).toHaveBeenCalledWith(11, {
				fromStationId: 1,
				toStationId: 2,
				oneWayFare: 330,
			});
		});

		// 04-api.md 4.7。1本でもあれば from / to を送っても 409。黙って経路が変わるのを防ぐ
		it('使用中に駅を送ると SEGMENT_IN_USE を投げ、何も直さない', async () => {
			const { repository, stationsRepository, update } = createFakeRepositories({
				existing: [inUse],
				stations: [x, y, z],
			});
			const error = await failure(
				createSegmentsService(repository, stationsRepository).update(11, {
					oneWayFare: 320,
					toStationId: 3,
				}),
			);
			expect(error?.code).toBe('SEGMENT_IN_USE');
			expect(error?.message).toContain('出発駅・到着駅は変えられません');
			expect(update).not.toHaveBeenCalled();
		});

		it('未使用なら片方の駅だけ差し替えられ、もう片方は現在値のまま', async () => {
			const { repository, stationsRepository, update, findIdByStationPair } =
				createFakeRepositories({ existing: [unused], stations: [x, y, z] });
			await createSegmentsService(repository, stationsRepository).update(10, {
				oneWayFare: 320,
				toStationId: 3,
			});
			expect(findIdByStationPair).toHaveBeenCalledWith(1, 3);
			expect(update).toHaveBeenCalledWith(10, {
				fromStationId: 1,
				toStationId: 3,
				oneWayFare: 320,
			});
		});

		// 同一駅は差し替え後の組で見る。片方だけ送られたときは routes の zod では決められない
		it('片方だけ送って同一駅になれば INVALID_VALUE を投げる', async () => {
			const { repository, stationsRepository, update } = createFakeRepositories({
				existing: [unused],
			});
			const error = await failure(
				createSegmentsService(repository, stationsRepository).update(10, {
					oneWayFare: 320,
					fromStationId: 2,
				}),
			);
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe('出発駅と到着駅は別の駅にしてください');
			expect(update).not.toHaveBeenCalled();
		});

		it('差し替え先の駅が無ければ INVALID_VALUE を投げる', async () => {
			const { repository, stationsRepository, update } = createFakeRepositories({
				existing: [unused],
				stations: [x, y],
			});
			const error = await failure(
				createSegmentsService(repository, stationsRepository).update(10, {
					oneWayFare: 320,
					toStationId: 3,
				}),
			);
			expect(error?.code).toBe('INVALID_VALUE');
			expect(error?.message).toBe('到着駅が見つかりません');
			expect(update).not.toHaveBeenCalled();
		});

		// 04-api.md 4.7。重複の判定からは自分自身を除く
		it('自分自身と同じ駅ペアなら重複としない', async () => {
			const { repository, stationsRepository, update } = createFakeRepositories({
				existing: [unused],
				duplicatedId: 10,
			});
			await createSegmentsService(repository, stationsRepository).update(10, {
				oneWayFare: 330,
				fromStationId: 1,
				toStationId: 2,
			});
			expect(update).toHaveBeenCalled();
		});

		it('他の区間と同じ駅ペアになれば SEGMENT_DUPLICATED を投げる', async () => {
			const { repository, stationsRepository, update } = createFakeRepositories({
				existing: [unused],
				stations: [x, y, z],
				duplicatedId: 12,
			});
			const error = await failure(
				createSegmentsService(repository, stationsRepository).update(10, {
					oneWayFare: 320,
					toStationId: 3,
				}),
			);
			expect(error?.code).toBe('SEGMENT_DUPLICATED');
			expect(update).not.toHaveBeenCalled();
		});
	});

	describe('remove', () => {
		const unused: Segment = {
			id: 10,
			fromStationId: 1,
			fromStationName: 'X鉄甲駅',
			toStationId: 2,
			toStationName: 'X鉄乙駅',
			oneWayFare: 320,
			routeCount: 0,
		};

		it('無い区間なら NOT_FOUND を投げる', async () => {
			const { repository, stationsRepository, remove } = createFakeRepositories();
			const error = await failure(createSegmentsService(repository, stationsRepository).remove(99));
			expect(error?.code).toBe('NOT_FOUND');
			expect(remove).not.toHaveBeenCalled();
		});

		// 決定22。RESTRICT を先回りして 409 に言い直す
		it('使用中なら SEGMENT_IN_USE を投げ、消さない', async () => {
			const { repository, stationsRepository, remove } = createFakeRepositories({
				existing: [{ ...unused, routeCount: 1 }],
			});
			const error = await failure(createSegmentsService(repository, stationsRepository).remove(10));
			expect(error?.code).toBe('SEGMENT_IN_USE');
			expect(remove).not.toHaveBeenCalled();
		});

		it('未使用なら消す', async () => {
			const { repository, stationsRepository, remove } = createFakeRepositories({
				existing: [unused],
			});
			await createSegmentsService(repository, stationsRepository).remove(10);
			expect(remove).toHaveBeenCalledWith(10);
		});
	});
});

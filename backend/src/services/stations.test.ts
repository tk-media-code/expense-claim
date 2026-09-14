import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import type { Station } from '../domain/station.js';
import type { StationsRepository } from '../repositories/stations.js';
import { createStationsService } from './stations.js';

// services は repository のインターフェースだけを見る（01-architecture.md 5.2）ので、偽物で足りる。
// モックは変数に持って expect に渡す（メソッド参照のまま渡すと unbound-method に当たる）。
function createFakeRepository(
	options: {
		stations?: Station[];
		existingId?: number | null;
		/** findById が返す駅。null なら「無い駅」 */
		found?: Station | null;
	} = {},
) {
	const list = vi.fn<StationsRepository['list']>(() => Promise.resolve(options.stations ?? []));
	const findIdByName = vi.fn<StationsRepository['findIdByName']>(() =>
		Promise.resolve(options.existingId ?? null),
	);
	const findById = vi.fn<StationsRepository['findById']>(() =>
		Promise.resolve(options.found ?? null),
	);
	const create = vi.fn<StationsRepository['create']>((name) =>
		Promise.resolve({ id: 1, name, segmentCount: 0 }),
	);
	const update = vi.fn<StationsRepository['update']>(() => Promise.resolve());
	const remove = vi.fn<StationsRepository['remove']>(() => Promise.resolve());
	const repository: StationsRepository = { list, findIdByName, findById, create, update, remove };
	return { repository, list, findIdByName, findById, create, update, remove };
}

function codeOf(promise: Promise<unknown>): Promise<string | null> {
	return promise.then(
		() => null,
		(cause: unknown) => (cause instanceof AppError ? cause.code : null),
	);
}

describe('stations service', () => {
	it('list は repository の一覧をそのまま返す', async () => {
		const stations = [{ id: 1, name: 'X鉄乙駅', segmentCount: 2 }];
		const { repository } = createFakeRepository({ stations });
		await expect(createStationsService(repository).list()).resolves.toBe(stations);
	});

	it('create は同じ名前が無ければ登録する', async () => {
		const { repository, create } = createFakeRepository();
		const created = await createStationsService(repository).create({ name: 'X鉄乙駅' });
		expect(created).toEqual({ id: 1, name: 'X鉄乙駅', segmentCount: 0 });
		expect(create).toHaveBeenCalledWith('X鉄乙駅');
	});

	// UNIQUE をアプリ側検証の代わりにしない（03-database.md 10.2）。先に読んで 409 にする。
	it('create は同じ名前があれば STATION_NAME_DUPLICATED を投げ、登録しない', async () => {
		const { repository, create } = createFakeRepository({ existingId: 7 });
		const error = await createStationsService(repository)
			.create({ name: 'X鉄乙駅' })
			.then(
				() => null,
				(cause: unknown) => cause,
			);
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('STATION_NAME_DUPLICATED');
		expect(create).not.toHaveBeenCalled();
	});

	// 決定22 / 04-api.md 4.7。名前は使われていても直せるが、削除は未使用のときだけ。
	describe('update', () => {
		it('無い駅なら NOT_FOUND を投げ、直さない', async () => {
			const { repository, update } = createFakeRepository({ found: null });
			await expect(
				codeOf(createStationsService(repository).update(1, { name: 'X鉄乙駅' })),
			).resolves.toBe('NOT_FOUND');
			expect(update).not.toHaveBeenCalled();
		});

		// これが 1-4 の主眼。使われている駅は消せないので、リネーム以外に道が残らない
		it('使われている駅でも改名でき、segmentCount はそのまま返る', async () => {
			const found = { id: 3, name: 'X鉄乙駅', segmentCount: 2 };
			const { repository, update } = createFakeRepository({ found });

			await expect(
				createStationsService(repository).update(3, { name: 'X鉄丙駅' }),
			).resolves.toEqual({
				id: 3,
				name: 'X鉄丙駅',
				segmentCount: 2,
			});
			expect(update).toHaveBeenCalledWith(3, 'X鉄丙駅');
		});

		it('別の駅と名前が重複すれば STATION_NAME_DUPLICATED を投げ、直さない', async () => {
			const found = { id: 3, name: 'X鉄乙駅', segmentCount: 0 };
			const { repository, update } = createFakeRepository({ found, existingId: 7 });
			await expect(
				codeOf(createStationsService(repository).update(3, { name: 'Y鉄乙駅' })),
			).resolves.toBe('STATION_NAME_DUPLICATED');
			expect(update).not.toHaveBeenCalled();
		});

		// 重複の判定から自分自身を除く（04-api.md 4.7）。findIdByName が id を返すのはこのため
		it('同じ名前で送っても、自分自身なら通る', async () => {
			const found = { id: 3, name: 'X鉄乙駅', segmentCount: 0 };
			const { repository, update } = createFakeRepository({ found, existingId: 3 });
			await expect(
				createStationsService(repository).update(3, { name: 'X鉄乙駅' }),
			).resolves.toMatchObject({ name: 'X鉄乙駅' });
			expect(update).toHaveBeenCalledWith(3, 'X鉄乙駅');
		});
	});

	describe('remove', () => {
		it('無い駅なら NOT_FOUND を投げ、消さない', async () => {
			const { repository, remove } = createFakeRepository({ found: null });
			await expect(codeOf(createStationsService(repository).remove(1))).resolves.toBe('NOT_FOUND');
			expect(remove).not.toHaveBeenCalled();
		});

		// RESTRICT をアプリ側検証の代わりにしない（03-database.md 10.2）。先に読んで 409 にする
		it('使っている区間があれば STATION_IN_USE を投げ、消さない', async () => {
			const found = { id: 3, name: 'X鉄乙駅', segmentCount: 1 };
			const { repository, remove } = createFakeRepository({ found });
			await expect(codeOf(createStationsService(repository).remove(3))).resolves.toBe(
				'STATION_IN_USE',
			);
			expect(remove).not.toHaveBeenCalled();
		});

		it('どの区間も使っていなければ消す', async () => {
			const found = { id: 3, name: 'X鉄乙駅', segmentCount: 0 };
			const { repository, remove } = createFakeRepository({ found });
			await createStationsService(repository).remove(3);
			expect(remove).toHaveBeenCalledWith(3);
		});
	});
});

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import type { Station } from '../domain/station.js';
import type { StationsRepository } from '../repositories/stations.js';
import { createStationsService } from './stations.js';

// services は repository のインターフェースだけを見る（01-architecture.md 5.2）ので、偽物で足りる。
// モックは変数に持って expect に渡す（メソッド参照のまま渡すと unbound-method に当たる）。
function createFakeRepository(options: { stations?: Station[]; existingId?: number | null } = {}) {
	const list = vi.fn<StationsRepository['list']>(() => Promise.resolve(options.stations ?? []));
	const findIdByName = vi.fn<StationsRepository['findIdByName']>(() =>
		Promise.resolve(options.existingId ?? null),
	);
	const create = vi.fn<StationsRepository['create']>((name) =>
		Promise.resolve({ id: 1, name, segmentCount: 0 }),
	);
	const repository: StationsRepository = { list, findIdByName, create };
	return { repository, list, findIdByName, create };
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
});

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import type { Venue } from '../domain/venue.js';
import type { VenuesRepository } from '../repositories/venues.js';
import { createVenuesService } from './venues.js';

// services は repository のインターフェースだけを見る（01-architecture.md 5.2）ので、偽物で足りる。
function createFakeRepository(options: { venues?: Venue[]; duplicatedId?: number | null } = {}) {
	const list = vi.fn<VenuesRepository['list']>(() => Promise.resolve(options.venues ?? []));
	const findById = vi.fn<VenuesRepository['findById']>(() => Promise.resolve(null));
	const findByCode = vi.fn<VenuesRepository['findByCode']>(() => Promise.resolve(null));
	const findIdByCode = vi.fn<VenuesRepository['findIdByCode']>(() =>
		Promise.resolve(options.duplicatedId ?? null),
	);
	const create = vi.fn<VenuesRepository['create']>((input) =>
		Promise.resolve({ id: 10, ...input, routes: [] }),
	);
	const repository: VenuesRepository = { list, findById, findByCode, findIdByCode, create };
	return { repository, create, findIdByCode };
}

function failure(promise: Promise<unknown>): Promise<AppError | null> {
	return promise.then(
		() => null,
		(cause: unknown) => (cause instanceof AppError ? cause : null),
	);
}

describe('venues service', () => {
	it('list は repository の一覧をそのまま返す', async () => {
		const venues: Venue[] = [
			{ id: 1, code: 'AAA', name: '甲ホール', source: 'master', routes: [] },
		];
		const { repository } = createFakeRepository({ venues });
		await expect(createVenuesService(repository).list()).resolves.toBe(venues);
	});

	// F-14 / 04-api.md 4.7。手で足す会場は manual 固定で、リクエストに source は無い
	it('create は source を manual で固定して登録する', async () => {
		const { repository, create } = createFakeRepository();
		const created = await createVenuesService(repository).create({ code: 'DDD', name: '丁会館' });
		expect(created).toMatchObject({ id: 10, code: 'DDD', source: 'manual', routes: [] });
		expect(create).toHaveBeenCalledWith({ code: 'DDD', name: '丁会館', source: 'manual' });
	});

	it('会場コードが既にあれば VENUE_CODE_DUPLICATED を投げ、登録しない', async () => {
		const { repository, create, findIdByCode } = createFakeRepository({ duplicatedId: 3 });
		const error = await failure(
			createVenuesService(repository).create({ code: 'AAA', name: '甲ホール' }),
		);
		expect(error?.code).toBe('VENUE_CODE_DUPLICATED');
		expect(findIdByCode).toHaveBeenCalledWith('AAA');
		expect(create).not.toHaveBeenCalled();
	});
});

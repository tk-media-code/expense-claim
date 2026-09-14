import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { segments } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import { createStationsRepository } from './stations.js';

// 駅名は架空の値だけを使う。実在の駅名は書かない（公開リポジトリ）。
// 並びを見るテストは先頭の英字（W < X < Y < Z）で順序が決まる名前にし、
// 漢字の照合順序に依らないようにする。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
const repository = createStationsRepository(db);

const at = new Date('2026-09-14T00:00:00Z');

async function insertSegment(fromStationId: number, toStationId: number): Promise<void> {
	await db
		.insert(segments)
		.values({ fromStationId, toStationId, oneWayFare: 320, createdAt: at, updatedAt: at });
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => null,
		(cause: unknown) => cause,
	);
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('stations repository', () => {
	it('create は id を振り、segmentCount 0 の駅を返す', async () => {
		const created = await repository.create('X鉄乙駅');
		expect(created).toEqual({
			id: expect.any(Number) as unknown,
			name: 'X鉄乙駅',
			segmentCount: 0,
		});
	});

	// 02-screens.md 3.8。出発駅として使われても到着駅として使われても、その駅の区間として数える。
	it('list は名前順で、出発駅・到着駅どちらで使われていても区間を数える', async () => {
		const y = await repository.create('Y鉄乙駅');
		const z = await repository.create('Z鉄乙駅');
		const x = await repository.create('X鉄乙駅');
		const w = await repository.create('W鉄乙駅');
		await insertSegment(x.id, y.id);
		await insertSegment(y.id, z.id);

		await expect(repository.list()).resolves.toEqual([
			{ id: w.id, name: 'W鉄乙駅', segmentCount: 0 },
			{ id: x.id, name: 'X鉄乙駅', segmentCount: 1 },
			{ id: y.id, name: 'Y鉄乙駅', segmentCount: 2 },
			{ id: z.id, name: 'Z鉄乙駅', segmentCount: 1 },
		]);
	});

	it('findIdByName は同じ名前の id を返し、無ければ null を返す', async () => {
		const created = await repository.create('X鉄乙駅');
		await expect(repository.findIdByName('X鉄乙駅')).resolves.toBe(created.id);
		await expect(repository.findIdByName('Y鉄乙駅')).resolves.toBeNull();
	});

	// services の先読みをすり抜けた重複を、DB の UNIQUE で拾って同じ 409 に写す（二重の網）。
	// 1-3 の API はこの code を返す（04-api.md 4.7）。
	it('同じ名前を2回 create すると STATION_NAME_DUPLICATED を投げる', async () => {
		await repository.create('X鉄乙駅');
		const error = await rejection(repository.create('X鉄乙駅'));
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('STATION_NAME_DUPLICATED');
		expect((error as AppError).status).toBe(409);
	});
});

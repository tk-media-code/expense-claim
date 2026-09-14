import { eq } from 'drizzle-orm';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { segments, stations } from '../db/schema.js';
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

async function updatedAtOf(id: number): Promise<Date | undefined> {
	const rows = await db
		.select({ updatedAt: stations.updatedAt })
		.from(stations)
		.where(eq(stations.id, id));
	return rows[0]?.updatedAt;
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

	// 1-4 の PUT / DELETE は、これ1本で「無い」と「使用中」を分ける。
	it('findById は segmentCount つきで返し、無い id では null を返す', async () => {
		const x = await repository.create('X鉄乙駅');
		const y = await repository.create('Y鉄乙駅');
		await insertSegment(x.id, y.id);

		await expect(repository.findById(x.id)).resolves.toEqual({
			id: x.id,
			name: 'X鉄乙駅',
			segmentCount: 1,
		});
		await expect(repository.findById(y.id)).resolves.toMatchObject({ segmentCount: 1 });
		await expect(repository.findById(x.id + y.id + 1)).resolves.toBeNull();
	});

	// DATETIME は秒までしか持たないので、動いたことを見るには過去へ寄せてから比べる。
	it('update は名前を差し替え、updatedAt を進める', async () => {
		const created = await repository.create('X鉄乙駅');
		await db.update(stations).set({ updatedAt: at }).where(eq(stations.id, created.id));

		await repository.update(created.id, 'X鉄丙駅');

		await expect(repository.findById(created.id)).resolves.toMatchObject({ name: 'X鉄丙駅' });
		expect((await updatedAtOf(created.id))?.getTime()).toBeGreaterThan(at.getTime());
	});

	// create と同じ二重の網。services の先読みをすり抜けた重複を、同じ 409 に写す。
	it('update が既存の名前に当たると STATION_NAME_DUPLICATED を投げる', async () => {
		await repository.create('X鉄乙駅');
		const target = await repository.create('Y鉄乙駅');

		const error = await rejection(repository.update(target.id, 'X鉄乙駅'));
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('STATION_NAME_DUPLICATED');
		await expect(repository.findById(target.id)).resolves.toMatchObject({ name: 'Y鉄乙駅' });
	});

	it('remove は駅を消す', async () => {
		const created = await repository.create('X鉄乙駅');
		await repository.remove(created.id);
		await expect(repository.findById(created.id)).resolves.toBeNull();
	});

	// 03-database.md 6.2 の stations → segments は RESTRICT。二重の網の2枚目で、
	// services の先読みをすり抜けた「使用中」を同じ 409 に写す（決定22）。
	it('remove が使用中の駅に当たると STATION_IN_USE を投げ、駅も区間も残る', async () => {
		const from = await repository.create('X鉄甲駅');
		const to = await repository.create('X鉄乙駅');
		await insertSegment(from.id, to.id);

		const error = await rejection(repository.remove(to.id));
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('STATION_IN_USE');
		expect((error as AppError).status).toBe(409);
		await expect(repository.findById(to.id)).resolves.toMatchObject({ segmentCount: 1 });
	});
});

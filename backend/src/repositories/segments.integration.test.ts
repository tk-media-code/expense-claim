import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { routeSegments, routes, venues } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import { createSegmentsRepository } from './segments.js';
import { createStationsRepository } from './stations.js';

// 駅名・会場は架空の値だけを使う。実在の値は書かない（公開リポジトリ）。
// 並びを見るテストは先頭の英字（X < Y < Z）で順序が決まる名前にし、漢字の照合順序に依らないようにする。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);
const repository = createSegmentsRepository(db);
const stations = createStationsRepository(db);

const at = new Date('2026-09-14T00:00:00Z');

// ルートの API はまだ無い（2-4）ので、routeCount を数える相手は DB に直接入れる
async function insertRoute(name: string): Promise<number> {
	const [venue] = await db
		.insert(venues)
		.values({
			code: `V${name}`,
			name: `${name}ホール`,
			source: 'master',
			createdAt: at,
			updatedAt: at,
		})
		.$returningId();
	if (!venue) throw new Error('会場の insert が id を返さなかった');
	const [route] = await db
		.insert(routes)
		.values({ venueId: venue.id, name: '乙駅乗換', createdAt: at, updatedAt: at })
		.$returningId();
	if (!route) throw new Error('ルートの insert が id を返さなかった');
	return route.id;
}

async function useSegment(routeId: number, sortOrder: number, segmentId: number): Promise<void> {
	await db
		.insert(routeSegments)
		.values({ routeId, sortOrder, segmentId, createdAt: at, updatedAt: at });
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

describe('segments repository', () => {
	it('create は id を振り、駅名と routeCount 0 つきの区間を返す', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const created = await repository.create({
			fromStationId: x.id,
			toStationId: y.id,
			oneWayFare: 320,
		});
		expect(created).toEqual({
			id: expect.any(Number) as unknown,
			fromStationId: x.id,
			fromStationName: 'X鉄甲駅',
			toStationId: y.id,
			toStationName: 'X鉄乙駅',
			oneWayFare: 320,
			routeCount: 0,
		});
	});

	// 02-screens.md 3.8。何本のルートに効くかを出す。route_segments に UNIQUE (route_id, segment_id) が
	// 無い（03-database.md 5.1）ので、同じ区間を2回使うルートを2本と数えない
	it('list は出発駅名→到着駅名の順で、区間を使っているルートの本数を数える', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('Y鉄乙駅');
		const z = await stations.create('Z鉄丙駅');
		const yz = await repository.create({ fromStationId: y.id, toStationId: z.id, oneWayFare: 210 });
		const xz = await repository.create({ fromStationId: x.id, toStationId: z.id, oneWayFare: 500 });
		const xy = await repository.create({ fromStationId: x.id, toStationId: y.id, oneWayFare: 320 });

		// 2本のルートが X→Y を共有し（決定18）、片方は同じ区間を2回使う
		const routeA = await insertRoute('A');
		const routeB = await insertRoute('B');
		await useSegment(routeA, 1, xy.id);
		await useSegment(routeA, 2, yz.id);
		await useSegment(routeB, 1, xy.id);
		await useSegment(routeB, 2, xy.id);

		await expect(repository.list()).resolves.toEqual([
			{ ...xy, routeCount: 2 },
			{ ...xz, routeCount: 0 },
			{ ...yz, routeCount: 1 },
		]);
	});

	// 1-6 の登録が重複を先読みし、1-7 の PUT が「判定から自分自身を除く」ために id を返す。
	// この検索は方向付き。逆向きの重複は services が両方向を引いて見る（決定24）
	it('findIdByStationPair は同じ駅ペアの id を返し、無ければ・逆向きなら null を返す', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const created = await repository.create({
			fromStationId: x.id,
			toStationId: y.id,
			oneWayFare: 320,
		});
		await expect(repository.findIdByStationPair(x.id, y.id)).resolves.toBe(created.id);
		await expect(repository.findIdByStationPair(y.id, x.id)).resolves.toBeNull();
	});

	// 1-7 の PUT / DELETE は、これ1本で「無い」と「使用中」を分ける
	it('findById は routeCount つきで返し、無い id では null を返す', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const created = await repository.create({
			fromStationId: x.id,
			toStationId: y.id,
			oneWayFare: 320,
		});
		await useSegment(await insertRoute('A'), 1, created.id);

		await expect(repository.findById(created.id)).resolves.toEqual({ ...created, routeCount: 1 });
		await expect(repository.findById(created.id + 1)).resolves.toBeNull();
	});

	// services の先読みをすり抜けた重複を、DB の UNIQUE で拾って同じ 409 に写す（二重の網）
	it('同じ駅ペアを2回 create すると SEGMENT_DUPLICATED を投げる', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const input = { fromStationId: x.id, toStationId: y.id, oneWayFare: 320 };
		await repository.create(input);
		const error = await rejection(repository.create({ ...input, oneWayFare: 330 }));
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('SEGMENT_DUPLICATED');
		expect((error as AppError).status).toBe(409);
	});

	// 先読みの後に駅が消された競合を、FK で拾って services と同じ 422 に写す（二重の網）
	it('無い駅を指して create すると INVALID_VALUE を投げる', async () => {
		const x = await stations.create('X鉄甲駅');
		const error = await rejection(
			repository.create({ fromStationId: x.id, toStationId: x.id + 1, oneWayFare: 320 }),
		);
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('INVALID_VALUE');
		expect((error as AppError).status).toBe(422);
		expect((error as AppError).message).toBe('指定した駅が見つかりません');
	});

	it('update は3列とも書き換え、駅名つきで読み直して返す', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const z = await stations.create('X鉄丙駅');
		const created = await repository.create({
			fromStationId: x.id,
			toStationId: y.id,
			oneWayFare: 320,
		});
		const updated = await repository.update(created.id, {
			fromStationId: y.id,
			toStationId: z.id,
			oneWayFare: 410,
		});
		expect(updated).toEqual({
			id: created.id,
			fromStationId: y.id,
			fromStationName: 'X鉄乙駅',
			toStationId: z.id,
			toStationName: 'X鉄丙駅',
			oneWayFare: 410,
			routeCount: 0,
		});
		await expect(repository.findById(created.id)).resolves.toEqual(updated);
	});

	// 判定から自分自身を除いた先読みをすり抜けた重複を、UNIQUE で拾って同じ 409 に写す（二重の網）
	it('update で他の区間と同じ駅ペアにすると SEGMENT_DUPLICATED を投げる', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const z = await stations.create('X鉄丙駅');
		await repository.create({ fromStationId: x.id, toStationId: y.id, oneWayFare: 320 });
		const xz = await repository.create({ fromStationId: x.id, toStationId: z.id, oneWayFare: 500 });
		const error = await rejection(
			repository.update(xz.id, { fromStationId: x.id, toStationId: y.id, oneWayFare: 500 }),
		);
		expect((error as AppError).code).toBe('SEGMENT_DUPLICATED');
	});

	it('remove は区間を消す', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const created = await repository.create({
			fromStationId: x.id,
			toStationId: y.id,
			oneWayFare: 320,
		});
		await repository.remove(created.id);
		await expect(repository.findById(created.id)).resolves.toBeNull();
	});

	// services の先読みをすり抜けた「使用中」を、RESTRICT で拾って同じ 409 に写す（二重の網）
	it('使われている区間を remove すると SEGMENT_IN_USE を投げ、区間は残る', async () => {
		const x = await stations.create('X鉄甲駅');
		const y = await stations.create('X鉄乙駅');
		const created = await repository.create({
			fromStationId: x.id,
			toStationId: y.id,
			oneWayFare: 320,
		});
		await useSegment(await insertRoute('A'), 1, created.id);
		const error = await rejection(repository.remove(created.id));
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('SEGMENT_IN_USE');
		expect((error as AppError).status).toBe(409);
		await expect(repository.findById(created.id)).resolves.toEqual({ ...created, routeCount: 1 });
	});
});

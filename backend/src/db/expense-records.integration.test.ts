import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { expenseRecordLegs, expenseRecords, projects, routes, venues } from './schema.js';

// 03-database.md 5.2 / 6.2 / 7章。実績は記録時点の形で固定され、設定データから切り離されている。
// ここで固定するのは ON DELETE の向き（案件 → 記録は CASCADE、ルート → 記録は SET NULL）と、
// 案件1対 0..1 の UNIQUE である。値は架空（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-09-05T10:03:00Z');

async function count(table: string): Promise<number> {
	const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
	return Number(rows[0]?.count);
}

async function insertProject(projectNo: string): Promise<number> {
	const [row] = await db
		.insert(projects)
		.values({
			projectNo,
			serviceDate: '2026-09-05',
			venueCode: 'AAA',
			venueName: '甲ホール',
			coupleName: '〇〇様△△様',
			source: 'manual',
			createdAt: at,
			updatedAt: at,
		})
		.$returningId();
	if (!row) throw new Error('案件の insert が id を返さなかった');
	return row.id;
}

async function insertRoute(): Promise<number> {
	const [venue] = await db
		.insert(venues)
		.values({ code: 'AAA', name: '甲ホール', source: 'master', createdAt: at, updatedAt: at })
		.$returningId();
	if (!venue) throw new Error('会場の insert が id を返さなかった');
	const [route] = await db
		.insert(routes)
		.values({ venueId: venue.id, name: '乙駅乗換', createdAt: at, updatedAt: at })
		.$returningId();
	if (!route) throw new Error('ルートの insert が id を返さなかった');
	return route.id;
}

async function insertRecord(projectId: number, routeId: number | null): Promise<number> {
	const [record] = await db
		.insert(expenseRecords)
		.values({
			projectId,
			tripType: 'round',
			outboundRouteId: routeId,
			returnRouteId: routeId,
			recordedAt: at,
			createdAt: at,
			updatedAt: at,
		})
		.$returningId();
	if (!record) throw new Error('記録の insert が id を返さなかった');
	await db.insert(expenseRecordLegs).values([
		{
			expenseRecordId: record.id,
			sortOrder: 1,
			fromStationName: 'X鉄甲駅',
			toStationName: 'X鉄乙駅',
			amount: 640,
		},
		{
			expenseRecordId: record.id,
			sortOrder: 2,
			fromStationName: 'Y鉄乙駅',
			toStationName: 'Y鉄丙駅',
			amount: 420,
		},
	]);
	return record.id;
}

function rejection(query: PromiseLike<unknown>): Promise<unknown> {
	return Promise.resolve(query).then(
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

describe('expense_records / expense_record_legs', () => {
	// 要件定義 6.2。1案件に交通費記録は 0 か 1
	it('同じ案件に2件目の記録は UNIQUE で弾く', async () => {
		const projectId = await insertProject('100000001');
		await insertRecord(projectId, null);
		const error = await rejection(insertRecord(projectId, null));
		expect((error as Error).cause).toMatchObject({ code: 'ER_DUP_ENTRY' });
	});

	// F-12 / 6.2。案件を消せば記録と区間の行も消える
	it('案件を消すと記録と区間の行が CASCADE で消える', async () => {
		const projectId = await insertProject('100000001');
		await insertRecord(projectId, null);
		await db.delete(projects);
		await expect(count('expense_records')).resolves.toBe(0);
		await expect(count('expense_record_legs')).resolves.toBe(0);
	});

	// 7章。ルートは実績より長く生きる。消えても実績は自立している
	it('ルートを消すと記録の参照は NULL になり、区間の行は残る', async () => {
		const projectId = await insertProject('100000001');
		const routeId = await insertRoute();
		const recordId = await insertRecord(projectId, routeId);
		await db.delete(routes);
		const [record] = await db.select().from(expenseRecords);
		expect(record).toMatchObject({ id: recordId, outboundRouteId: null, returnRouteId: null });
		await expect(count('expense_record_legs')).resolves.toBe(2);
	});

	// 4.3。順序を持つ子は (親, sort_order) が UNIQUE
	it('同じ記録に同じ sort_order の行は弾く', async () => {
		const projectId = await insertProject('100000001');
		const recordId = await insertRecord(projectId, null);
		const error = await rejection(
			db.insert(expenseRecordLegs).values({
				expenseRecordId: recordId,
				sortOrder: 1,
				fromStationName: 'a',
				toStationName: 'b',
				amount: 1,
			}),
		);
		expect((error as Error).cause).toMatchObject({ code: 'ER_DUP_ENTRY' });
	});
});

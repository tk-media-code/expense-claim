import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { projects, receipts, taxiRides } from './schema.js';

// 03-database.md 5.2 の taxi_rides と receipts。乗車1回につき領収書1件（UNIQUE）と、
// 案件 → 乗車 → 領収書の CASCADE を実テーブルで固定する。値は架空
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-09-05T10:00:00Z');

async function count(table: string): Promise<number> {
	const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
	return Number(rows[0]?.count);
}

async function insertProject(): Promise<number> {
	const [row] = await db
		.insert(projects)
		.values({
			projectNo: '100000001',
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

async function insertRide(projectId: number, amount: number): Promise<number> {
	const [row] = await db
		.insert(taxiRides)
		.values({ projectId, rodeOn: '2026-09-05', amount, createdAt: at })
		.$returningId();
	if (!row) throw new Error('乗車の insert が id を返さなかった');
	return row.id;
}

async function insertReceipt(taxiRideId: number): Promise<void> {
	await db.insert(receipts).values({
		taxiRideId,
		driveFileId: 'file-1',
		driveUrl: 'https://drive.google.com/file/d/file-1/view',
		fileName: '20260905_AAA_1.jpg',
		mimeType: 'image/jpeg',
		storedAt: at,
	});
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

describe('taxi_rides / receipts', () => {
	// R-12。乗車1回につき領収書は1件
	it('同じ乗車に2件目の領収書は UNIQUE で弾く', async () => {
		const ride = await insertRide(await insertProject(), 1800);
		await insertReceipt(ride);
		const error = await rejection(insertReceipt(ride));
		expect((error as Error).cause).toMatchObject({ code: 'ER_DUP_ENTRY' });
	});

	// F-22。1日に複数回乗る。案件に複数の乗車がぶら下がる
	it('1案件に複数の乗車が入る', async () => {
		const projectId = await insertProject();
		await insertRide(projectId, 1800);
		await insertRide(projectId, 1400);
		await expect(count('taxi_rides')).resolves.toBe(2);
	});

	// F-12 / 6.2。案件を消せば乗車と領収書の行も消える。ファイル実体は消えない（消す経路が無い）
	it('案件を消すと乗車と領収書の行が CASCADE で消える', async () => {
		const projectId = await insertProject();
		await insertReceipt(await insertRide(projectId, 1800));
		await db.delete(projects);
		await expect(count('taxi_rides')).resolves.toBe(0);
		await expect(count('receipts')).resolves.toBe(0);
	});
});

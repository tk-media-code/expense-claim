import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { importedMails, projects } from './schema.js';

// 03-database.md 5.3 の imported_mails と、projects.imported_mail_id（5.2）。
// 1通の案件詳細メールは1案件（UNIQUE）で、メールは消さない（RESTRICT）。値は架空
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-08-31T01:00:00Z');

async function insertMail(id: string): Promise<void> {
	await db
		.insert(importedMails)
		.values({ id, threadId: null, result: 'project', internalDate: at, processedAt: at });
}

async function insertProject(projectNo: string, importedMailId: string | null): Promise<void> {
	await db.insert(projects).values({
		projectNo,
		serviceDate: '2026-09-05',
		venueCode: 'AAA',
		venueName: '甲ホール',
		coupleName: '〇〇様△△様',
		source: importedMailId ? 'mail' : 'manual',
		importedMailId,
		createdAt: at,
		updatedAt: at,
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

describe('imported_mails / projects.imported_mail_id', () => {
	it('同じメールから2件の案件は UNIQUE で弾く', async () => {
		await insertMail('mail-1');
		await insertProject('100000001', 'mail-1');
		const error = await rejection(insertProject('100000002', 'mail-1'));
		expect((error as Error).cause).toMatchObject({ code: 'ER_DUP_ENTRY' });
	});

	// 手動追加は NULL で、NULL は重複してよい
	it('手動追加の案件は imported_mail_id が NULL で、何件でも入る', async () => {
		await insertProject('100000001', null);
		await insertProject('100000002', null);
		const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM projects');
		expect(Number(rows[0]?.count)).toBe(2);
	});

	// 6.2。案件が参照しているメールは消せない（そもそも消さない）
	it('案件が参照しているメールは RESTRICT で消せない', async () => {
		await insertMail('mail-1');
		await insertProject('100000001', 'mail-1');
		const error = await rejection(db.delete(importedMails));
		expect((error as Error).cause).toMatchObject({ code: 'ER_ROW_IS_REFERENCED_2' });
	});

	// 要件定義 6.3。案件を消してもメールの行は残る
	it('案件を消してもメールの行は残る', async () => {
		await insertMail('mail-1');
		await insertProject('100000001', 'mail-1');
		await db.delete(projects);
		const [rows] = await pool.query<RowDataPacket[]>(
			'SELECT COUNT(*) AS count FROM imported_mails',
		);
		expect(Number(rows[0]?.count)).toBe(1);
	});
});

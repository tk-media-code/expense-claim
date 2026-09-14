import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { projects } from './schema.js';

// 03-database.md 5.2 の projects。UNIQUE (project_no) が二重取り込み（F-08）の一段目なので、
// 実テーブルで効いていることをここで固定する。
//
// 案件番号・会場コード・ご両家名は設計書と同じ架空の値だけを使う。実在の値は書かない（公開リポジトリ）。
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

const at = new Date('2026-09-14T00:00:00Z');

async function insertProject(projectNo: string, serviceDate: string): Promise<void> {
	await db.insert(projects).values({
		projectNo,
		serviceDate,
		venueCode: 'AAA',
		venueName: '甲ホール',
		coupleName: '〇〇様△△様',
		source: 'manual',
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

describe('projects', () => {
	// F-08 / 03-database.md 5.2。同じ案件番号は DB が拒む。手で足した案件にも効く
	it('同じ案件番号は UNIQUE で弾く', async () => {
		await insertProject('100000001', '2026-09-05');
		const error = await rejection(insertProject('100000001', '2026-09-12'));
		expect((error as Error).cause).toMatchObject({
			code: 'ER_DUP_ENTRY',
			sqlMessage: expect.stringContaining('projects_project_no_unique') as unknown,
		});
	});

	// 03-database.md 4.2。DATE は暦日として扱い、往復で日がずれない
	it('施行日が暦日のまま往復する', async () => {
		await insertProject('100000001', '2026-09-05');
		const [row] = await db.select({ serviceDate: projects.serviceDate }).from(projects);
		expect(row?.serviceDate).toBe('2026-09-05');
	});

	// 03-database.md 9.1。月度の列は無く、範囲検索の索引がある
	it('service_date に索引がある', async () => {
		const [rows] = await pool.query<RowDataPacket[]>(
			'SHOW INDEX FROM projects WHERE Key_name = ?',
			['projects_service_date_index'],
		);
		expect(rows).toHaveLength(1);
	});

	// 03-database.md 8章。会場コードは外部キーではない。マスタに無いコードでも入る
	it('venues に無い会場コードでも入る', async () => {
		await db.insert(projects).values({
			projectNo: '100000009',
			serviceDate: '2026-09-05',
			venueCode: 'ZZZ',
			venueName: '未登録の会場',
			coupleName: '〇〇様△△様',
			source: 'mail',
			createdAt: at,
			updatedAt: at,
		});
		const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM projects');
		expect(Number(rows[0]?.count)).toBe(1);
	});
});

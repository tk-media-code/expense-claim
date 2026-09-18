import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { parseTargetMonth, type TargetMonth } from '../domain/month.js';
import { createSubmissionsRepository } from './submissions.js';

const pool: Pool = createTestPool();
const repository = createSubmissionsRepository(createTestDatabase(pool));

function month(value: string): TargetMonth {
	const parsed = parseTargetMonth(value);
	if (!parsed) throw new Error(value);
	return parsed;
}

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('createSubmissionsRepository', () => {
	// F-29 / F-30。何度でも実行でき、最新の実行日時が「いつ提出したか」
	it('月度ごとに複数行になり、最新の実行を返す', async () => {
		await repository.add(month('2026-08'), new Date('2026-09-02T01:00:00Z'), 7);
		await repository.add(month('2026-08'), new Date('2026-09-03T01:00:00Z'), 8);
		await expect(repository.findLatest(month('2026-08'))).resolves.toEqual({
			targetMonth: '2026-08',
			executedAt: new Date('2026-09-03T01:00:00Z'),
			writtenRows: 8,
		});
		await expect(repository.findLatest(month('2026-09'))).resolves.toBeNull();
	});

	it('提出済みの月度をまとめて引ける', async () => {
		await repository.add(month('2026-08'), new Date('2026-09-02T01:00:00Z'), 7);
		const found = await repository.submittedMonths([month('2026-08'), month('2026-09')]);
		expect([...found.keys()]).toEqual(['2026-08']);
		expect(found.get(month('2026-08'))).toEqual(new Date('2026-09-02T01:00:00Z'));
	});

	// 03-database.md 4.4。月初以外の月度を DB が弾く
	it('月初以外の月度を CHECK で弾く', async () => {
		await expect(
			pool.query(
				"INSERT INTO submissions (target_month, executed_at, written_rows) VALUES ('2026-08-15', NOW(), 1)",
			),
		).rejects.toThrow(/submissions_target_month_is_first_day|Check constraint/i);
	});
});

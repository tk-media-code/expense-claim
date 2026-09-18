import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { createAuthStateRepository } from './auth-state.js';

const pool: Pool = createTestPool();
const repository = createAuthStateRepository(createTestDatabase(pool));

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('createAuthStateRepository', () => {
	it('行が無ければ失効なし', async () => {
		await expect(repository.find()).resolves.toEqual({ sessionsValidAfter: null });
	});

	// 04-api.md 4.1。基準時刻を1つだけ持ち、上書きされる。行は増えない
	it('失効の基準時刻を書き、二度書いても行は1つのまま', async () => {
		await repository.invalidateSessionsBefore(new Date('2026-09-05T10:00:00Z'));
		await repository.invalidateSessionsBefore(new Date('2026-09-06T10:00:00Z'));
		await expect(repository.find()).resolves.toEqual({
			sessionsValidAfter: new Date('2026-09-06T10:00:00Z'),
		});
		const [rows] = await pool.query('SELECT COUNT(*) AS count FROM auth_state');
		expect(Number((rows as { count: number }[])[0]?.count)).toBe(1);
	});

	// 03-database.md 4.4。CHECK (id = 1) が効いている
	it('2 行目を弾く', async () => {
		await expect(
			pool.query('INSERT INTO auth_state (id, updated_at) VALUES (2, NOW())'),
		).rejects.toThrow(/auth_state_single_row|Check constraint/i);
	});
});

import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { createSyncStateRepository } from './sync-state.js';

const pool: Pool = createTestPool();
const repository = createSyncStateRepository(createTestDatabase(pool));

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('createSyncStateRepository', () => {
	it('行が無ければ null を返す', async () => {
		await expect(repository.find()).resolves.toBeNull();
	});

	it('書いた値をそのまま読み戻せる', async () => {
		const state = {
			lastImportedAt: new Date('2026-09-09T03:04:05Z'),
			lastSeenTargetMonth: '2026-09-01',
			lastAlertSentOn: '2026-09-03',
			lastCronRunAt: new Date('2026-09-09T00:00:00Z'),
			updatedAt: new Date('2026-09-09T03:04:05Z'),
		};
		await repository.save(state);
		await expect(repository.find()).resolves.toEqual(state);
	});

	// 03-database.md 4.2。DATETIME は UTC で入れる。
	// 接続のタイムゾーンに振り回されると、cron の死活も月度の判定もずれる。
	it('DATETIME が UTC のまま往復する', async () => {
		const at = new Date('2026-01-01T15:30:00Z');
		await repository.save({
			lastImportedAt: at,
			lastSeenTargetMonth: null,
			lastAlertSentOn: null,
			lastCronRunAt: null,
			updatedAt: at,
		});
		const found = await repository.find();
		expect(found?.lastImportedAt?.toISOString()).toBe('2026-01-01T15:30:00.000Z');
	});

	// 03-database.md 4.2。DATE を Date オブジェクトへ通すと 1 日ずれ、
	// 決定12（月度は施行日で決まる）を気づかないうちに壊す。
	it('DATE が文字列のまま往復し、日がずれない', async () => {
		await repository.save({
			lastImportedAt: null,
			lastSeenTargetMonth: '2026-09-01',
			lastAlertSentOn: '2026-12-01',
			lastCronRunAt: null,
			updatedAt: new Date('2026-09-09T00:00:00Z'),
		});
		const found = await repository.find();
		expect(found?.lastSeenTargetMonth).toBe('2026-09-01');
		expect(found?.lastAlertSentOn).toBe('2026-12-01');
	});

	it('二度 save しても行が増えない（単一行）', async () => {
		const base = {
			lastImportedAt: null,
			lastSeenTargetMonth: null,
			lastAlertSentOn: null,
			lastCronRunAt: null,
			updatedAt: new Date('2026-09-09T00:00:00Z'),
		};
		await repository.save(base);
		await repository.save({ ...base, lastSeenTargetMonth: '2026-10-01' });

		const [rows] = await pool.query('SELECT COUNT(*) AS count FROM sync_state');
		expect(Number((rows as { count: number }[])[0]?.count)).toBe(1);
		await expect(repository.find()).resolves.toMatchObject({ lastSeenTargetMonth: '2026-10-01' });
	});
});

// 03-database.md 4.4。DB は二重の網であって一枚目ではないが、張った網は効いている必要がある。
describe('sync_state の CHECK 制約', () => {
	it('2 行目を弾く', async () => {
		await pool.query('INSERT INTO sync_state (id, updated_at) VALUES (1, NOW())');
		await expect(
			pool.query('INSERT INTO sync_state (id, updated_at) VALUES (2, NOW())'),
		).rejects.toThrow(/sync_state_single_row|Check constraint/i);
	});

	it('月初以外の月度を弾く', async () => {
		await expect(
			pool.query(
				"INSERT INTO sync_state (id, last_seen_target_month, updated_at) VALUES (1, '2026-09-15', NOW())",
			),
		).rejects.toThrow(/sync_state_target_month_is_first_day|Check constraint/i);
	});
});

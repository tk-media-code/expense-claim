import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { createGoogleCredentialsRepository } from './google-credentials.js';

const pool: Pool = createTestPool();
const repository = createGoogleCredentialsRepository(createTestDatabase(pool));

const at = new Date('2026-09-01T02:00:00Z');
const bytes = new Uint8Array([
	1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
]);

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('createGoogleCredentialsRepository', () => {
	it('行が無ければ null', async () => {
		await expect(repository.find()).resolves.toBeNull();
	});

	// 03-database.md 5.3。暗号化済みのバイト列がそのまま往復し、スコープは短い名前で戻る
	it('保存したバイト列とスコープを読み戻せ、二度保存しても行は1つ', async () => {
		await repository.save({
			refreshTokenEncrypted: bytes,
			scopeUrls: [
				'https://www.googleapis.com/auth/spreadsheets',
				'https://www.googleapis.com/auth/drive.file',
			],
			authorizedAt: at,
		});
		await repository.save({
			refreshTokenEncrypted: bytes,
			scopeUrls: ['https://www.googleapis.com/auth/spreadsheets'],
			authorizedAt: new Date('2026-09-02T02:00:00Z'),
		});
		const found = await repository.find();
		expect(Buffer.from(found?.refreshTokenEncrypted ?? []).equals(Buffer.from(bytes))).toBe(true);
		expect(found?.scopes).toEqual(['spreadsheets']);
		expect(found?.authorizedAt).toEqual(new Date('2026-09-02T02:00:00Z'));
		const [rows] = await pool.query('SELECT COUNT(*) AS count FROM google_credentials');
		expect(Number((rows as { count: number }[])[0]?.count)).toBe(1);
	});

	it('replaceToken はトークンだけを差し替える', async () => {
		await repository.save({ refreshTokenEncrypted: bytes, scopeUrls: [], authorizedAt: at });
		const next = new Uint8Array(bytes.map((b) => b + 1));
		await repository.replaceToken(next, new Date('2026-09-03T00:00:00Z'));
		const found = await repository.find();
		expect(Buffer.from(found?.refreshTokenEncrypted ?? []).equals(Buffer.from(next))).toBe(true);
		expect(found?.authorizedAt).toEqual(at);
	});
});

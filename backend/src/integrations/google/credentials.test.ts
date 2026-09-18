import { describe, expect, it } from 'vitest';

import { decryptToken, encryptToken } from './credentials.js';

const secret = 'token-encryption-key-for-tests';

describe('token encryption', () => {
	it('暗号化した値を同じ鍵で戻せ、毎回違うバイト列になる', async () => {
		const a = await encryptToken(secret, '1//refresh-token');
		const b = await encryptToken(secret, '1//refresh-token');
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
		await expect(decryptToken(secret, a)).resolves.toBe('1//refresh-token');
		await expect(decryptToken(secret, b)).resolves.toBe('1//refresh-token');
	});

	it('鍵が違えば戻せない', async () => {
		const encrypted = await encryptToken(secret, '1//refresh-token');
		await expect(decryptToken('another-key', encrypted)).resolves.toBeNull();
	});

	it('改ざんされていれば戻せない', async () => {
		const encrypted = await encryptToken(secret, '1//refresh-token');
		encrypted[encrypted.length - 1] = (encrypted[encrypted.length - 1] ?? 0) ^ 0xff;
		await expect(decryptToken(secret, encrypted)).resolves.toBeNull();
	});

	it('形が違えば戻せない', async () => {
		await expect(decryptToken(secret, new Uint8Array(3))).resolves.toBeNull();
	});
});

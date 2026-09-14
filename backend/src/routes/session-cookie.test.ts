import { describe, expect, it } from 'vitest';

import { signSession, verifySessionToken } from './session-cookie.js';

const secret = 'test-secret-that-is-long-enough';
const session = { sub: 'sub-1', iat: 1_788_000_000 };

describe('session token', () => {
	it('署名した中身を読み戻せる', async () => {
		const token = await signSession(secret, session);
		expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		await expect(verifySessionToken(secret, token)).resolves.toEqual(session);
	});

	it('鍵が違えば読めない', async () => {
		const token = await signSession(secret, session);
		await expect(verifySessionToken('another-secret-that-is-long', token)).resolves.toBeNull();
	});

	it('中身を書き換えた Cookie は読めない', async () => {
		const token = await signSession(secret, session);
		const [, signature] = token.split('.');
		const forged = `${Buffer.from(JSON.stringify({ sub: 'sub-2', iat: session.iat })).toString('base64url')}.${signature}`;
		await expect(verifySessionToken(secret, forged)).resolves.toBeNull();
	});

	it.each(['', 'abc', 'a.b.c', 'not-base64.sig'])('形が違う「%s」は読めない', async (token) => {
		await expect(verifySessionToken(secret, token)).resolves.toBeNull();
	});
});

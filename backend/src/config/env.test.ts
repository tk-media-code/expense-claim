import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

const required = {
	DATABASE_URL: 'mysql://u:p@h:3306/d',
	SESSION_SECRET: 'a-secret-long-enough-for-hmac',
	ALLOWED_EMAIL: 'me@example.com',
};

describe('loadEnv', () => {
	it('PORT を数値へ変換する', () => {
		const env = loadEnv({ ...required, PORT: '3000' });
		expect(env.PORT).toBe(3000);
	});

	it('PORT が無ければ 3000 を使う', () => {
		const env = loadEnv(required);
		expect(env.PORT).toBe(3000);
	});

	// 足りない設定を抱えたまま動き出さない。最初のリクエストまで気づけないため。
	it.each([
		['DATABASE_URL', { ...required, DATABASE_URL: undefined }],
		['SESSION_SECRET', { ...required, SESSION_SECRET: undefined }],
		['SESSION_SECRET', { ...required, SESSION_SECRET: 'short' }],
		['ALLOWED_EMAIL', { ...required, ALLOWED_EMAIL: '' }],
	])('%s が正しくなければ落ちる', (name, source) => {
		expect(() => loadEnv(source)).toThrow(new RegExp(name));
	});

	// OAuth クライアントは無くても起動する。ログインの入口だけが使えない
	it('Google の設定は省ける', () => {
		const env = loadEnv(required);
		expect(env.GOOGLE_CLIENT_ID).toBe('');
	});

	it('PORT が数値でなければ落ちる', () => {
		expect(() => loadEnv({ ...required, PORT: 'ポート' })).toThrow(/PORT/);
	});
});

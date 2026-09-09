import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

describe('loadEnv', () => {
	it('PORT を数値へ変換する', () => {
		const env = loadEnv({ DATABASE_URL: 'mysql://u:p@h:3306/d', PORT: '3000' });
		expect(env.PORT).toBe(3000);
	});

	it('PORT が無ければ 3000 を使う', () => {
		const env = loadEnv({ DATABASE_URL: 'mysql://u:p@h:3306/d' });
		expect(env.PORT).toBe(3000);
	});

	// 足りない設定を抱えたまま動き出さない。最初のリクエストまで気づけないため。
	it('DATABASE_URL が無ければ落ちる', () => {
		expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
	});

	it('PORT が数値でなければ落ちる', () => {
		expect(() => loadEnv({ DATABASE_URL: 'mysql://u:p@h:3306/d', PORT: 'ポート' })).toThrow(/PORT/);
	});
});

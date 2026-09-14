import { test as base } from '@playwright/test';

import { sessionToken } from './session.js';

// ログイン済みの page と request。全テストがこれを使う（未ログインの挙動を見るテストだけ base を使う）
export const test = base.extend({
	context: async ({ context, baseURL }, use) => {
		await context.addCookies([
			{
				name: 'session',
				value: sessionToken(),
				url: baseURL ?? 'http://localhost:8080',
				httpOnly: true,
				sameSite: 'Lax',
			},
		]);
		await use(context);
	},
	request: async ({ playwright, baseURL }, use) => {
		const request = await playwright.request.newContext({
			baseURL,
			extraHTTPHeaders: { cookie: `session=${sessionToken()}` },
		});
		await use(request);
		await request.dispose();
	},
});

export { expect } from '@playwright/test';

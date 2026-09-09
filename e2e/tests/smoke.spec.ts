import { expect, test } from '@playwright/test';

// スモーク1本。nginx → frontend と nginx → backend の配線が生きていることだけを見る。
//
// 「帰り道の2手」（02-screens.md 2.2）と「提出」（3.9）の導線は、
// 画面が出来てから足す。まだ無い画面のテストは書けない。
test('トップが開く', async ({ page }) => {
	const response = await page.goto('/');
	expect(response?.status()).toBe(200);
	await expect(page).toHaveTitle('expense-claim');
});

test('GET /api/health が 200 を返す', async ({ request }) => {
	const response = await request.get('/api/health');
	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({ status: 'ok' });
});

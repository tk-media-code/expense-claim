import { expect, test } from '@playwright/test';

// 未ログインの挙動だけは、Cookie を載せない素の test で見る（NF-06 / 02-screens.md 3.1）
test('未ログインで開くとログイン画面へ飛ぶ', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByTestId('login')).toContainText('Google でログイン');
});

test('未ログインの API は 401 を共通のエラー形式で返す', async ({ request }) => {
	const response = await request.get('/api/home');
	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual({
		error: { code: 'UNAUTHENTICATED', message: 'ログインしてください' },
	});
});

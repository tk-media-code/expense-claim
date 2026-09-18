import { expect, test } from './fixtures.js';

import { seedRecordable } from './helpers.js';

// 「帰り道の2手」（02-screens.md 2.2 / 07-development.md 4章）。
// ルートが1本の会場の、今日の案件。ホームの「記録する」→ 記録画面の「保存」の2手で終わり、
// 2手目までにキーボード入力が現れない。これが成立するかどうかが、このアプリの成否を決める。
test('帰り道の記録は2手で終わる', async ({ page, request }) => {
	const fixture = await seedRecordable(request);
	try {
		await page.goto('/');
		const card = page.getByTestId('project').filter({ hasText: fixture.coupleName });
		await expect(card).toContainText('未記録');

		// 1手目。カードの「記録する」
		await card.getByRole('link', { name: '記録する' }).click();
		await expect(page).toHaveURL(new RegExp(`/projects/${fixture.projectId}/record$`));

		// 開いた時点で埋まっている（3.5）。ルートは選択済み、区間と金額が出ている、保存できる
		await expect(page.getByTestId('summary')).toContainText(fixture.coupleName);
		await expect(page.getByTestId('legs')).toContainText('640円');
		await expect(page.getByTestId('total')).toHaveText('640円');
		const save = page.getByTestId('save');
		await expect(save).toBeEnabled();

		// 2手目。「保存」。開いた画面（ホーム）へ帰る
		await save.click();
		await expect(page).toHaveURL(/\/$/);
		await expect(card).toContainText('記録済み');
		await expect(card).toContainText('640円');
		await expect(card.getByRole('link', { name: '記録する' })).toHaveCount(0);
	} finally {
		await fixture.cleanup();
	}
});

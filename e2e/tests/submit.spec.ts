import { expect, test } from './fixtures.js';
import { seedRecordable } from './helpers.js';

// 提出の導線（02-screens.md 3.9 / 07-development.md 4章）。確認 → 実行 → 結果。
// 開発の compose は GOOGLE_STUB=1 で、提出シートは「対象月度 = 今月・書ける行 8〜32」の開発用の実装。
// 今日の案件を記録してから提出画面を開き、書き込む行が提出シートの列そのままに出て、実行できることを見る
test('提出は確認してから実行し、書いた行数が出る', async ({ page, request }) => {
	const fixture = await seedRecordable(request, 'E2S');
	try {
		// 記録済みにする（2手の経路は record.spec.ts が見る。ここは API で済ませる）
		const recorded = await request.put(`/api/projects/${fixture.projectId}/expense-record`, {
			data: { tripType: 'round', outboundRouteId: fixture.routeId },
		});
		expect(recorded.status()).toBe(200);

		await page.goto('/');
		// ホームの「提出」が押せる（対象月度に記録済みの案件がある）
		const submit = page.getByTestId('submit');
		await expect(submit).toBeEnabled();
		await submit.click();
		await expect(page).toHaveURL(/\/submit$/);

		// 確認の段。行の一覧に、記録した案件の行が書き込む形のまま出る（F-27）
		const rows = page.getByTestId('rows');
		await expect(rows).toBeVisible();
		const row = rows.locator('tbody tr').filter({ hasText: fixture.coupleName });
		await expect(row).toHaveCount(1);
		await expect(row).toContainText('E2S');
		await expect(row).toContainText('往復');
		await expect(row).toContainText('640');
		// 開発用の会場マスタは空なので、会場コードの警告が出る（N-14。止めない）
		await expect(page.getByTestId('warnings')).toContainText(
			'会場コード E2S が会場マスタにありません',
		);

		// 実行。結果に書いた行数が出る
		await page.getByTestId('submit').click();
		await expect(page.getByTestId('done')).toBeVisible();
		await expect(page.getByTestId('done')).toContainText(/\d+ 行を書きました/);

		// ホームに戻ると提出済みになっている（F-30）
		await page.getByRole('link', { name: 'ホームへ戻る' }).click();
		await expect(page).toHaveURL(/\/$/);
		const month = page.getByTestId('month').filter({ hasText: fixture.coupleName });
		await expect(month.locator('h2')).toContainText('提出済み');
	} finally {
		await fixture.cleanup();
	}
});

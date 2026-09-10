import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { errorCatalog } from '../domain/app-error.js';

describe('GET /api/health', () => {
	it('200 と status: ok を返す', async () => {
		const res = await createApp().request('/api/health');
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ status: 'ok' });
	});

	// createApp() を通した実物で notFound が効いているのを確かめるのはここだけ。
	// 失敗が必ず 04-api.md 2.5 の形になることを、フロントの API クライアントが前提にする。
	it('定義していないパスは 404 を共通のエラー形式で返す', async () => {
		const res = await createApp().request('/api/does-not-exist');
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toContain('application/json');
		await expect(res.json()).resolves.toEqual({
			error: { code: 'NOT_FOUND', message: errorCatalog.NOT_FOUND.message },
		});
	});
});

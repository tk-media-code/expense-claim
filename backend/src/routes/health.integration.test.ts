import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

describe('GET /api/health', () => {
	it('200 と status: ok を返す', async () => {
		const res = await createApp().request('/api/health');
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ status: 'ok' });
	});

	it('定義していないパスは 404 を返す', async () => {
		const res = await createApp().request('/api/does-not-exist');
		expect(res.status).toBe(404);
	});
});

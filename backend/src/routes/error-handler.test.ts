import { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, errorCatalog } from '../domain/app-error.js';
import { handleError, handleNotFound } from './error-handler.js';

// 使い捨ての Hono にハンドラだけを載せる。createApp() を通さないので DB も設定も要らない。
function createTestApp(throwing: () => never) {
	const app = new Hono();
	app.get('/boom', throwing);
	app.onError(handleError);
	app.notFound(handleNotFound);
	return app;
}

describe('handleError', () => {
	// 想定外の例外は console.error へ出す設計なので、テスト出力を汚さないよう握り潰す。
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

	beforeEach(() => {
		errorSpy.mockClear();
	});

	afterAll(() => {
		errorSpy.mockRestore();
	});

	it('AppError を code の状態と共通形式で返す', async () => {
		const app = createTestApp(() => {
			throw new AppError('PROJECT_NO_DUPLICATED');
		});

		const res = await app.request('/boom');

		expect(res.status).toBe(409);
		expect(res.headers.get('content-type')).toContain('application/json');
		await expect(res.json()).resolves.toEqual({
			error: {
				code: 'PROJECT_NO_DUPLICATED',
				message: errorCatalog.PROJECT_NO_DUPLICATED.message,
			},
		});
	});

	it('上書きした文面をそのまま返す', async () => {
		const app = createTestApp(() => {
			throw new AppError('INVALID_VALUE', { message: '運賃に負の値は入れられません' });
		});

		const res = await app.request('/boom');

		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INVALID_VALUE', message: '運賃に負の値は入れられません' },
		});
	});

	it('4xx の AppError はログに出さない', async () => {
		const app = createTestApp(() => {
			throw new AppError('NOT_FOUND');
		});

		await app.request('/boom');

		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('5xx の AppError はログに出す', async () => {
		const err = new AppError('SHEET_UNREACHABLE', { cause: new Error('403 from Google') });
		const app = createTestApp(() => {
			throw err;
		});

		const res = await app.request('/boom');

		expect(res.status).toBe(502);
		expect(errorSpy).toHaveBeenCalledWith(err);
	});

	it('想定外の例外は 500 INTERNAL_ERROR にし、元の文面を漏らさない', async () => {
		const app = createTestApp(() => {
			throw new Error('DATABASE_URL=mysql://user:pw@host/db が読めません');
		});

		const res = await app.request('/boom');

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({
			error: { code: 'INTERNAL_ERROR', message: errorCatalog.INTERNAL_ERROR.message },
		});
		// ログには全部出す。追えなくなるほうが害が大きい。
		expect(errorSpy).toHaveBeenCalledOnce();
	});
});

describe('handleNotFound', () => {
	it('未定義のパスを 404 NOT_FOUND の共通形式で返す', async () => {
		const app = createTestApp(() => {
			throw new Error('ここは通らない');
		});

		const res = await app.request('/does-not-exist');

		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toContain('application/json');
		await expect(res.json()).resolves.toEqual({
			error: { code: 'NOT_FOUND', message: errorCatalog.NOT_FOUND.message },
		});
	});
});

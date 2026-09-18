import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { setResponseStatus } from 'h3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { ApiError, UNREACHABLE_MESSAGE } from '~/utils/api-error';

// テスト環境の fetch は登録した /api/* を h3 の実物に通す。状態コードも本文もそのまま届く。
// useToast() を setup の外で呼ぶと inject() の警告が出るので、Nuxt のコンテキストの中で掴む。
// runWithContext はサーバー側の型を含めて Promise を返しうるので await で剥がす（クライアントでは同期）。
async function grabToast() {
	return await useNuxtApp().runWithContext(() => useToast());
}

async function toastTitles() {
	// add() は nextTick のあとで toasts に載る。
	await nextTick();
	return (await grabToast()).toasts.value.map((toast) => toast.title);
}

describe('$api', () => {
	afterEach(async () => {
		(await grabToast()).clear();
	});

	it('baseURL の /api を付けて叩く', async () => {
		registerEndpoint('/api/ping', () => ({ status: 'ok' }));

		await expect(useApi()('/ping')).resolves.toEqual({ status: 'ok' });
	});

	it('エラー応答を ApiError で reject し、message をトーストに出す', async () => {
		registerEndpoint('/api/missing', (event) => {
			setResponseStatus(event, 404);
			return { error: { code: 'NOT_FOUND', message: '見つかりませんでした' } };
		});

		const failure = await useApi()('/missing').catch((err: unknown) => err);

		expect(failure).toBeInstanceOf(ApiError);
		expect(failure).toMatchObject({
			code: 'NOT_FOUND',
			status: 404,
			message: '見つかりませんでした',
		});
		expect(await toastTitles()).toContain('見つかりませんでした');
	});

	it('API の形でない応答は UNREACHABLE で reject し、既定の文面をトーストに出す', async () => {
		// 登録していないパスは h3 の既定の 404（error を持たない JSON）が返る。
		const failure = await useApi()('/not-registered').catch((err: unknown) => err);

		expect(failure).toBeInstanceOf(ApiError);
		expect(failure).toMatchObject({
			code: 'UNREACHABLE',
			status: 404,
			message: UNREACHABLE_MESSAGE,
		});
		expect(await toastTitles()).toContain(UNREACHABLE_MESSAGE);
	});

	it('失敗を黙って再試行しない', async () => {
		// ofetch の既定なら GET の 503 は1回再試行され、ハンドラが2回呼ばれる。
		const handler = vi.fn((event: Parameters<typeof setResponseStatus>[0]) => {
			setResponseStatus(event, 503);
			return { error: { code: 'GOOGLE_UNAUTHORIZED', message: 'Google との連携が切れています' } };
		});
		registerEndpoint('/api/flaky', handler);

		await expect(useApi()('/flaky')).rejects.toBeInstanceOf(ApiError);

		expect(handler).toHaveBeenCalledTimes(1);
	});

	// 04-api.md 2.5。401 はログイン画面へ導き、トーストは出さない
	it('401 はトーストを出さず、ログイン済みの印を落とす', async () => {
		registerEndpoint('/api/private', (event) => {
			setResponseStatus(event, 401);
			return { error: { code: 'UNAUTHENTICATED', message: 'ログインしてください' } };
		});
		useAuthenticated().value = true;

		const failure = await useApi()('/private').catch((err: unknown) => err);

		expect(failure).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
		expect(await toastTitles()).not.toContain('ログインしてください');
		expect(useAuthenticated().value).toBe(false);
	});

	// F-02。503 は設定の「再認可する」へ導く導線をトーストに添える
	it('503 GOOGLE_UNAUTHORIZED は設定へ導くトーストを出す', async () => {
		registerEndpoint('/api/needs-google', (event) => {
			setResponseStatus(event, 503);
			return { error: { code: 'GOOGLE_UNAUTHORIZED', message: 'Google との連携が切れています' } };
		});

		await useApi()('/needs-google').catch(() => undefined);

		const toast = (await grabToast()).toasts.value.find(
			(t) => t.title === 'Google との連携が切れています',
		);
		expect(toast?.actions?.[0]).toMatchObject({ label: '設定を開く', to: '/settings' });
	});
});

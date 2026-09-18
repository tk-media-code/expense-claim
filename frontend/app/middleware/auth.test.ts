import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';

import middleware from './auth.global';

// test/setup.ts は /api/auth/session をログイン済みで登録している。ここでは useApi ごと差し替えて未ログインを作る
const session = vi.fn<() => Promise<unknown>>(() => Promise.resolve({ authenticated: true }));
mockNuxtImport('useApi', () => () => session);

function route(path: string): RouteLocationNormalized {
	return { path } as RouteLocationNormalized;
}

describe('auth middleware（02-screens.md 3.1）', () => {
	beforeEach(() => {
		useAuthenticated().value = false;
		session.mockReset();
		session.mockResolvedValue({ authenticated: true });
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('ログイン済みなら通し、印を立てて以後は聞かない', async () => {
		expect(await middleware(route('/'), route('/'))).toBeUndefined();
		expect(useAuthenticated().value).toBe(true);
		expect(session).toHaveBeenCalledWith('/auth/session');

		await middleware(route('/venues'), route('/'));
		expect(session).toHaveBeenCalledTimes(1);
	});

	it('未ログインならログイン画面へ飛ばす', async () => {
		session.mockRejectedValue(new Error('401'));
		// middleware の外から呼ぶと navigateTo は router.push を待つ Promise を返すので、行き先で確かめる
		await middleware(route('/'), route('/'));
		expect(useRouter().currentRoute.value.path).toBe('/login');
		expect(useAuthenticated().value).toBe(false);
	});

	it('ログイン画面自身には掛からない', async () => {
		session.mockRejectedValue(new Error('401'));
		expect(await middleware(route('/login'), route('/'))).toBeUndefined();
		expect(session).not.toHaveBeenCalled();
	});
});

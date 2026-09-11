import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import DefaultLayout from './default.vue';

describe('layouts/default.vue', () => {
	it('ホームは画面名と「案件を追加」とメニューを出し、戻るは出さない', async () => {
		const wrapper = await mountSuspended(DefaultLayout, { route: '/' });

		expect(wrapper.get('h1').text()).toBe('ホーム');
		expect(wrapper.find('[aria-label="戻る"]').exists()).toBe(false);

		const add = wrapper.get('a[href="/projects/new"]');
		expect(add.text()).toContain('案件を追加');
		expect(wrapper.find('[aria-label="メニュー"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="color-mode"]').exists()).toBe(true);
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	it('会場とルートはホームへ戻り、メニューを出さない', async () => {
		const wrapper = await mountSuspended(DefaultLayout, { route: '/venues' });

		expect(wrapper.get('h1').text()).toBe('会場とルート');
		expect(wrapper.get('[aria-label="戻る"]').attributes('href')).toBe('/');
		expect(wrapper.find('[aria-label="メニュー"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="color-mode"]').exists()).toBe(true);
	});

	it('詳細から開いた記録画面は詳細へ戻る', async () => {
		const wrapper = await mountSuspended(DefaultLayout, {
			route: '/projects/7/record?from=detail',
		});

		expect(wrapper.get('[aria-label="戻る"]').attributes('href')).toBe('/projects/7');
	});

	it('ルートの追加は会場とルートへ戻る', async () => {
		const wrapper = await mountSuspended(DefaultLayout, { route: '/routes/new' });

		expect(wrapper.get('[aria-label="戻る"]').attributes('href')).toBe('/venues');
	});

	it('アプリバーのボタンでダークとライトを切り替える', async () => {
		const wrapper = await mountSuspended(DefaultLayout, { route: '/' });
		const colorMode = await useNuxtApp().runWithContext(() => useColorMode());
		const toggle = wrapper.get('[data-testid="color-mode"]');

		expect(colorMode.preference).toBe('light');

		await toggle.trigger('click');
		await nextTick();
		expect(colorMode.preference).toBe('dark');

		await toggle.trigger('click');
		await nextTick();
		expect(colorMode.preference).toBe('light');
	});
});

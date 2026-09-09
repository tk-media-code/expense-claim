import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import IndexPage from './index.vue';

// Nuxt UI の部品が実際に描画され、イベントが繋がっていることを機械で確かめる。
// 画面そのものは 02-screens.md の実装フェーズで作る。
describe('pages/index.vue', () => {
	it('UButton が描画される', async () => {
		const wrapper = await mountSuspended(IndexPage);
		const button = wrapper.find('[data-testid="press"]');
		expect(button.exists()).toBe(true);
		expect(button.element.tagName).toBe('BUTTON');
	});

	it('押すと回数が増える', async () => {
		const wrapper = await mountSuspended(IndexPage);
		expect(wrapper.get('[data-testid="count"]').text()).toBe('0');
		await wrapper.get('[data-testid="press"]').trigger('click');
		expect(wrapper.get('[data-testid="count"]').text()).toBe('1');
	});
});

import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

import App from './app.vue';

// 土台が動くことだけを確かめる。画面と部品は Issue #74（Nuxt UI）以降で増える。
describe('app.vue', () => {
	it('Nuxt の環境でマウントできる', async () => {
		const wrapper = await mountSuspended(App);
		expect(wrapper.html()).toContain('<div');
	});
});

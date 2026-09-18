import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';

import LoginPage from './login.vue';

describe('/login（02-screens.md 3.1）', () => {
	afterEach(() => {
		// 画面を替えないと確かめられないので、遷移先を控えるだけにする
	});

	it('「Google でログイン」を出し、拒否メッセージは無い', async () => {
		const wrapper = await mountSuspended(LoginPage, { route: '/login' });
		expect(wrapper.find('[data-testid="login"]').text()).toContain('Google でログイン');
		expect(wrapper.find('[data-testid="login-error"]').exists()).toBe(false);
		expect(wrapper.text()).toContain('本人1人だけ');
	});

	// N-03 / 決定5。許可されたアカウント以外はログインできない。バックエンドが理由を ?error= で戻す
	it('?error= があれば拒否メッセージを出す', async () => {
		const wrapper = await mountSuspended(LoginPage, {
			route: '/login?error=' + encodeURIComponent('このアカウントでは利用できません'),
		});
		expect(wrapper.find('[data-testid="login-error"]').text()).toContain(
			'このアカウントでは利用できません',
		);
	});
});

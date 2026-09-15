import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfigBackup } from '~/types/config-backup';
import type { GoogleAuthorization, Settings } from '~/types/settings';
import SettingsPage from './settings.vue';

let settings: Settings;
let authorization: GoogleAuthorization;
const loggedOut = vi.fn<(path: string) => void>();
const imported = vi.fn<(body: unknown) => void>();

registerEndpoint('/api/settings', () => settings);
registerEndpoint('/api/google/authorization', () => authorization);
registerEndpoint('/api/auth/logout', {
	method: 'POST',
	handler: () => {
		loggedOut('/auth/logout');
		return null;
	},
});
registerEndpoint('/api/auth/logout-all', {
	method: 'POST',
	handler: () => {
		loggedOut('/auth/logout-all');
		return null;
	},
});
registerEndpoint('/api/settings/config-backup', {
	method: 'POST',
	handler: async (event) => {
		imported(await readBody(event));
		return { stations: 3, venues: 2, segments: 2, routes: 1 };
	},
});

let wrapper: VueWrapper | null = null;

beforeEach(() => {
	settings = {
		spreadsheetName: '交通費精算',
		sheetName: '9999 テスト太郎',
		targetMonth: '2026-08',
		google: { authorized: true, missingScopes: [] },
	};
	authorization = {
		authorized: true,
		scopes: ['gmail.readonly', 'gmail.send', 'drive.file', 'spreadsheets'],
		authorizedAt: '2026-09-01T02:00:00Z',
		missingScopes: [],
	};
	vi.clearAllMocks();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/settings（02-screens.md 3.11）', () => {
	it('認可済みなら認可日時と4つのスコープを出し、提出先は名前だけを出す', async () => {
		wrapper = await mountSuspended(SettingsPage, { route: '/settings' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('認可済み'));
		expect(wrapper.find('[data-testid="google"]').text()).toContain('9/1 11:00');
		expect(wrapper.findAll('[data-testid="scopes"] li')).toHaveLength(4);
		expect(wrapper.find('[data-testid="reauthorize"]').text()).toContain('再認可する');
		const destination = wrapper.find('[data-testid="destination"]').text();
		expect(destination).toContain('交通費精算');
		expect(destination).toContain('9999 テスト太郎');
		expect(destination).toContain('2026年8月度');
	});

	// 3.11。失効していたら目立たせる
	it('未認可なら目立たせ、「認可する」を出す', async () => {
		authorization = {
			authorized: false,
			scopes: [],
			authorizedAt: null,
			missingScopes: ['gmail.readonly', 'gmail.send', 'drive.file', 'spreadsheets'],
		};
		wrapper = await mountSuspended(SettingsPage, { route: '/settings' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('まだ認可していません'));
		expect(wrapper.find('[data-testid="reauthorize"]').text()).toContain('認可する');
	});

	// 3.11 / 04-api.md 4.2。gmail.send が足りないと、アラートの送信だけが失敗する。失敗してから気づくより先に導く
	it('足りないスコープがあれば、何の権限が無いかを出す', async () => {
		authorization = {
			...authorization,
			scopes: ['gmail.readonly', 'drive.file', 'spreadsheets'],
			missingScopes: ['gmail.send'],
		};
		wrapper = await mountSuspended(SettingsPage, { route: '/settings' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('足りない権限があります'));
		expect(wrapper.text()).toContain('提出アラートを送る');
	});

	it('?error= があれば再認可の失敗として出す', async () => {
		wrapper = await mountSuspended(SettingsPage, {
			route: '/settings?error=' + encodeURIComponent('認可の手続きが途中で変わりました'),
		});
		await vi.waitFor(() =>
			expect(wrapper!.find('[data-testid="authorization-error"]').exists()).toBe(true),
		);
		expect(wrapper.text()).toContain('認可の手続きが途中で変わりました');
	});

	it('「すべての端末からログアウト」は logout-all を叩く', async () => {
		wrapper = await mountSuspended(SettingsPage, { route: '/settings' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('認可済み'));
		await wrapper.find('[data-testid="logout-all"]').trigger('click');
		await vi.waitFor(() => expect(loggedOut).toHaveBeenCalledWith('/auth/logout-all'));
	});

	it('書き出しは /api/settings/config-backup へ落とす', async () => {
		wrapper = await mountSuspended(SettingsPage, { route: '/settings' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('設定データの控え'));
		const exportLink = wrapper.find('[data-testid="export-config"]');
		expect(exportLink.attributes('href')).toBe('/api/settings/config-backup');
	});

	// 3.11 / 04-api.md 4.10。読み込みは置き換えなので、確認を挟んでから POST する
	it('控えを選んで確認すると、同じ JSON を POST する', async () => {
		const backup: ConfigBackup = {
			version: 1,
			exportedAt: '2026-09-15T00:00:00.000Z',
			stations: [{ name: 'X鉄甲駅' }],
			venues: [],
			segments: [],
			routes: [],
		};
		wrapper = await mountSuspended(SettingsPage, { route: '/settings' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('設定データの控え'));

		const input = wrapper.get('[data-testid="import-config-file"]').element as HTMLInputElement;
		const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
		Object.defineProperty(input, 'files', { configurable: true, value: [file] });
		await wrapper.get('[data-testid="import-config-file"]').trigger('change');

		await vi.waitFor(() => {
			const found = [...document.body.querySelectorAll('button')].find((button) =>
				button.textContent?.includes('置き換える'),
			);
			expect(found).toBeTruthy();
		});
		[...document.body.querySelectorAll('button')]
			.find((button) => button.textContent?.includes('置き換える'))
			?.click();
		await vi.waitFor(() => expect(imported).toHaveBeenCalledWith(backup));
	});
});

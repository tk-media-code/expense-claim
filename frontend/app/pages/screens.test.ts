import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describe, expect, it } from 'vitest';

import { backOf } from '~/utils/back-of';
import DetailPage from './projects/[id]/index.vue';
import RecordPage from './projects/[id]/record.vue';

// 遷移図 2.1 の画面と URL をそのまま回す。描画はしない。
const screens = [
	{ path: '/login', title: 'ログイン', back: undefined },
	{ path: '/', title: 'ホーム', back: undefined },
	{ path: '/projects/1', title: '案件の詳細', back: '/' },
	{ path: '/projects/new', title: '案件の追加', back: '/' },
	{ path: '/projects/1/record', title: '交通費の記録', back: '/' },
	{ path: '/projects/1/record?from=detail', title: '交通費の記録', back: '/projects/1' },
	{ path: '/venues', title: '会場とルート', back: '/' },
	{ path: '/routes/new', title: 'ルートの編集', back: '/venues' },
	{ path: '/routes/1', title: 'ルートの編集', back: '/venues' },
	{ path: '/segments', title: '区間と運賃', back: '/' },
	{ path: '/submit', title: '提出', back: '/' },
	{ path: '/attentions', title: '要確認事項', back: '/' },
	{ path: '/settings', title: '設定', back: '/' },
] as const;

describe('画面と URL（02-screens.md 2.1）', () => {
	it.each(screens)('$path の title と戻り先', ({ path, title, back }) => {
		const resolved = useRouter().resolve(path);
		expect(resolved.meta.title).toBe(title);
		expect(backOf(resolved as RouteLocationNormalizedLoaded)).toBe(back);
	});

	// `projects/[id].vue` と `projects/[id]/record.vue` を同居させると、記録が詳細の入れ子になり
	// `<NuxtPage />` が無い親だけが出る。兄弟ルート（`[id]/index.vue`）であることを描画で固定する。
	it('記録画面は詳細の中に入れ子にせず、自分の仮置きを出す', async () => {
		const wrapper = await mountSuspended(RecordPage, { route: '/projects/1/record' });
		expect(wrapper.text()).toContain('4-4');
		expect(wrapper.get('a[href="/venues"]').text()).toContain('会場とルートを開く');
	});

	it('案件の詳細から記録へは from=detail を付ける', async () => {
		const wrapper = await mountSuspended(DetailPage, { route: '/projects/1' });
		expect(wrapper.get('a[href="/projects/1/record?from=detail"]').text()).toContain('記録する');
	});
});

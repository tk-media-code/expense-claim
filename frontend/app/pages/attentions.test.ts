import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attention } from '~/types/attention';
import AttentionsPage from './attentions.vue';

// 文面は架空
let attentions: Attention[];
const checked = vi.fn<(id: number) => void>();

registerEndpoint('/api/attentions', () => ({ attentions }));
registerEndpoint('/api/attentions/1/check', {
	method: 'POST',
	handler: () => {
		checked(1);
		attentions = attentions.filter((a) => a.id !== 1);
		return { ...attentions[0], checkedAt: '2026-09-05T10:00:00Z' };
	},
});

let wrapper: VueWrapper | null = null;

beforeEach(() => {
	attentions = [
		{
			id: 1,
			kind: 'mail_parse_failed',
			detail: '9/1 10:00 に届いた件名「…」のメールから、会場コードを取り出せませんでした',
			occurredAt: '2026-09-01T01:00:00Z',
			checkedAt: null,
		},
		{
			id: 2,
			kind: 'rows_inserted',
			detail: '提出時に本文行が足りず、25行目の内側に 3 行を挿入しました',
			occurredAt: '2026-08-03T01:00:00Z',
			checkedAt: null,
		},
	];
	vi.clearAllMocks();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/attentions（02-screens.md 3.10）', () => {
	it('種別・内容・発生日時を並べる', async () => {
		wrapper = await mountSuspended(AttentionsPage, { route: '/attentions' });
		await vi.waitFor(() => expect(wrapper!.findAll('[data-testid="attention"]')).toHaveLength(2));
		const first = wrapper.findAll('[data-testid="attention"]')[0]?.text() ?? '';
		expect(first).toContain('メールの解析に失敗');
		expect(first).toContain('会場コードを取り出せませんでした');
		expect(first).toContain('9/1 10:00');
		expect(wrapper.findAll('[data-testid="attention"]')[1]?.text()).toContain('行を挿入した');
	});

	// F-34。確認済みにすると一覧から消える（行は残っている）
	it('「確認済みにする」で POST が飛び、一覧から消える', async () => {
		wrapper = await mountSuspended(AttentionsPage, { route: '/attentions' });
		await vi.waitFor(() => expect(wrapper!.findAll('[data-testid="attention"]')).toHaveLength(2));
		await wrapper.findAll('[data-testid="attention"] button')[0]?.trigger('click');
		await vi.waitFor(() => expect(checked).toHaveBeenCalledWith(1));
		await vi.waitFor(() => expect(wrapper!.findAll('[data-testid="attention"]')).toHaveLength(1));
	});

	it('0件ならその旨を出す', async () => {
		attentions = [];
		wrapper = await mountSuspended(AttentionsPage, { route: '/attentions' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('未確認の要確認事項はありません'));
	});
});

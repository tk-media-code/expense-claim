import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody, setResponseStatus } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { Route } from '~/types/route';
import type { Segment } from '~/types/segment';
import type { Venue } from '~/types/venue';
import EditPage from './[id].vue';
import NewPage from './new.vue';

// 会場・駅名は架空の値だけを使う（公開リポジトリ）。02-screens.md 2.4 のデータに合わせる
const xy: Segment = {
	id: 1,
	fromStationId: 1,
	fromStationName: 'X鉄甲駅',
	toStationId: 2,
	toStationName: 'X鉄乙駅',
	oneWayFare: 320,
	routeCount: 1,
};
const yz: Segment = {
	id: 2,
	fromStationId: 3,
	fromStationName: 'Y鉄乙駅',
	toStationId: 4,
	toStationName: 'Y鉄丙駅',
	oneWayFare: 210,
	routeCount: 1,
};
const venues: Venue[] = [
	{ id: 1, code: 'AAA', name: '甲ホール', source: 'master', routes: [] },
	{ id: 2, code: 'BBB', name: '乙迎賓館', source: 'master', routes: [] },
];
const existing: Route = {
	id: 7,
	venueId: 1,
	name: '乙駅乗換',
	legs: [
		{
			sortOrder: 1,
			segmentId: 1,
			fromStationName: 'X鉄甲駅',
			toStationName: 'X鉄乙駅',
			oneWayFare: 320,
		},
		{
			sortOrder: 2,
			segmentId: 2,
			fromStationName: 'Y鉄乙駅',
			toStationName: 'Y鉄丙駅',
			oneWayFare: 210,
		},
	],
};

const posted = vi.fn<(body: Record<string, unknown>) => void>();
const put = vi.fn<(body: Record<string, unknown>) => void>();
const segmentPosted = vi.fn<(body: Record<string, unknown>) => void>();

registerEndpoint('/api/segments', { method: 'GET', handler: () => ({ segments: [xy, yz] }) });
registerEndpoint('/api/venues', { method: 'GET', handler: () => ({ venues }) });
registerEndpoint('/api/stations', { method: 'GET', handler: () => ({ stations: [] }) });
registerEndpoint('/api/routes/7', { method: 'GET', handler: () => existing });
registerEndpoint('/api/routes/7', {
	method: 'PUT',
	handler: async (event) => {
		const body = await readBody<Record<string, unknown>>(event);
		put(body);
		return { ...existing, ...body };
	},
});
registerEndpoint('/api/routes', {
	method: 'POST',
	handler: async (event) => {
		const body = await readBody<Record<string, unknown>>(event);
		posted(body);
		setResponseStatus(event, 201);
		return { id: 8, ...body, legs: [] };
	},
});
registerEndpoint('/api/segments', {
	method: 'POST',
	handler: async (event) => {
		const body = await readBody<Record<string, unknown>>(event);
		segmentPosted(body);
		setResponseStatus(event, 201);
		const created: Segment = {
			id: 3,
			fromStationId: 5,
			fromStationName: 'X鉄甲駅',
			toStationId: 6,
			toStationName: 'Z鉄戊駅',
			oneWayFare: Number(body.oneWayFare),
			routeCount: 0,
		};
		return created;
	},
});

let wrapper: VueWrapper | null = null;

function legTexts(page: VueWrapper) {
	return page.findAll('[data-testid="legs"] li').map((li) => li.text());
}

function bodyButton(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((button) =>
		button.textContent?.includes(label),
	);
	if (!found) throw new Error(`ボタンが見つからない: ${label}`);
	return found;
}

async function pickVenue(page: VueWrapper, id: number) {
	const select = page.findComponent({ name: 'USelectMenu' });
	select.vm.$emit('update:modelValue', id);
	await nextTick();
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/routes/:id（02-screens.md 3.7）', () => {
	it('既存のルートの名前と区間の並びを出し、運賃は表示だけで入力欄が無い', async () => {
		wrapper = await mountSuspended(EditPage, { route: '/routes/7' });
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(2));

		expect(wrapper.get('input').element.value).toBe('乙駅乗換');
		expect(legTexts(wrapper)[0]).toContain('X鉄甲駅 → X鉄乙駅');
		expect(legTexts(wrapper)[0]).toContain('320円');
		expect(legTexts(wrapper)[1]).toContain('Y鉄乙駅 → Y鉄丙駅');
		expect(wrapper.text()).toContain('片道 530円');
		expect(wrapper.findAll('input[type="number"]')).toHaveLength(0);
	});

	// 決定20。並べ替えは上下ボタンで、押せば1つ動く
	it('上下ボタンで並べ替え、外すと減り、保存すると配列順の segmentIds で PUT が飛ぶ', async () => {
		wrapper = await mountSuspended(EditPage, { route: '/routes/7' });
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(2));

		await wrapper.get('button[aria-label="2番目を上へ"]').trigger('click');
		expect(legTexts(wrapper)[0]).toContain('Y鉄乙駅 → Y鉄丙駅');
		expect(wrapper.get('button[aria-label="1番目を上へ"]').attributes('disabled')).toBeDefined();

		await wrapper.get('form').trigger('submit');
		await vi.waitFor(() =>
			expect(put).toHaveBeenCalledWith({ venueId: 1, name: '乙駅乗換', segmentIds: [2, 1] }),
		);
	});

	it('区間を外すと並びから減る', async () => {
		wrapper = await mountSuspended(EditPage, { route: '/routes/7' });
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(2));
		await wrapper.get('button[aria-label="1番目を外す"]').trigger('click');
		expect(legTexts(wrapper)).toHaveLength(1);
		expect(legTexts(wrapper)[0]).toContain('Y鉄乙駅');
	});
});

describe('/routes/new', () => {
	it('会場とルートから来たときは会場が選ばれており、区間を足して登録すると POST が飛ぶ', async () => {
		wrapper = await mountSuspended(NewPage, { route: '/routes/new?venueId=2' });
		await nextTick();

		expect(wrapper.text()).toContain('まだ区間を並べていない');
		await wrapper.get('input').setValue('戊駅直通');

		// 「区間を足す」は登録済みの区間から選ぶシート
		wrapper
			.findAll('button')
			.find((b) => b.text().includes('区間を足す'))
			?.element.click();
		await nextTick();
		expect(document.body.textContent).toContain('区間を足す');
		bodyButton('X鉄甲駅 → X鉄乙駅').click();
		await nextTick();
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(1));

		await wrapper.get('form').trigger('submit');
		await vi.waitFor(() =>
			expect(posted).toHaveBeenCalledWith({ venueId: 2, name: '戊駅直通', segmentIds: [1] }),
		);
	});

	// 3.7。登録したものはそのままこのルートの並びに入る。登録だけして並びに入れない、をしない
	it('「区間を登録する」で作った区間は、そのまま並びに入る', async () => {
		wrapper = await mountSuspended(NewPage, { route: '/routes/new' });
		await nextTick();

		wrapper
			.findAll('button')
			.find((b) => b.text().includes('区間を登録する'))
			?.element.click();
		await nextTick();
		expect(document.body.textContent).toContain('区間を追加');

		const from = wrapper
			.findAllComponents({ name: 'StationPicker' })
			.find((c) => c.props('label') === '出発駅');
		const to = wrapper
			.findAllComponents({ name: 'StationPicker' })
			.find((c) => c.props('label') === '到着駅');
		from?.vm.$emit('update:modelValue', 5);
		to?.vm.$emit('update:modelValue', 6);
		const fare = document.body.querySelector<HTMLInputElement>('input[type="number"]');
		if (!fare) throw new Error('運賃の入力欄が見つからない');
		fare.value = '520';
		fare.dispatchEvent(new Event('input'));
		await nextTick();
		bodyButton('登録する').click();
		await vi.waitFor(() => expect(segmentPosted).toHaveBeenCalled());

		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(1));
		expect(legTexts(wrapper)[0]).toContain('X鉄甲駅 → Z鉄戊駅');
		expect(legTexts(wrapper)[0]).toContain('520円');
	});

	it('会場を選んでいなくても送り、サーバーの 422 に任せる', async () => {
		wrapper = await mountSuspended(NewPage, { route: '/routes/new' });
		await nextTick();
		await pickVenue(wrapper, 1);
		await wrapper.get('input').setValue('A');
		await wrapper.get('form').trigger('submit');
		await vi.waitFor(() =>
			expect(posted).toHaveBeenCalledWith({ venueId: 1, name: 'A', segmentIds: [] }),
		);
	});
});

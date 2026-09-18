import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody, setResponseStatus } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { Venue } from '~/types/venue';
import VenuesPage from './venues.vue';

// 会場コード・会場名は架空の値だけを使う（公開リポジトリ）。02-screens.md 2.4 のデータに合わせる
const aaa: Venue = {
	id: 1,
	code: 'AAA',
	name: '甲ホール',
	source: 'master',
	routes: [{ id: 1, name: '乙駅乗換', segmentCount: 2, oneWayTotal: 530 }],
};
const bbb: Venue = {
	id: 2,
	code: 'BBB',
	name: '乙迎賓館',
	source: 'master',
	routes: [
		{ id: 2, name: '丁駅乗換', segmentCount: 2, oneWayTotal: 590 },
		{ id: 3, name: '戊駅直通', segmentCount: 1, oneWayTotal: 520 },
	],
};
const eee: Venue = { id: 5, code: 'EEE', name: '戊スタジオ', source: 'manual', routes: [] };
// 会場マスタの会場名が空だと、コードが名前になる（取り込みの仕様）
const fff: Venue = { id: 6, code: 'FFF', name: 'FFF', source: 'master', routes: [] };

let venues: Venue[] = [];
let listFails = false;
const posted = vi.fn<(body: { code: string; name: string }) => void>();
const removed = vi.fn<(id: number) => void>();
const imported = vi.fn<() => void>();

registerEndpoint('/api/venues', {
	method: 'GET',
	handler: (event) => {
		if (listFails) {
			setResponseStatus(event, 500);
			return { error: { code: 'INTERNAL_ERROR', message: '予期しないエラーが発生しました' } };
		}
		return { venues };
	},
});

registerEndpoint('/api/venues', {
	method: 'POST',
	handler: async (event) => {
		const body = await readBody<{ code: string; name: string }>(event);
		posted(body);
		setResponseStatus(event, 201);
		const created: Venue = { id: 6, ...body, source: 'manual', routes: [] };
		venues = [...venues, created];
		return created;
	},
});

registerEndpoint('/api/venues/import', {
	method: 'POST',
	handler: () => {
		imported();
		venues = [...venues, { id: 7, code: 'CCC', name: '丙会館', source: 'master', routes: [] }];
		return { inserted: 1, updated: 0, unchanged: 2, skipped: 1 };
	},
});

registerEndpoint('/api/routes/1', {
	method: 'DELETE',
	handler: (event) => {
		removed(1);
		venues = venues.map((venue) => ({
			...venue,
			routes: venue.routes.filter((route) => route.id !== 1),
		}));
		setResponseStatus(event, 204);
		return null;
	},
});

let wrapper: VueWrapper | null = null;

async function openPage() {
	wrapper = await mountSuspended(VenuesPage, { route: '/venues' });
	return wrapper;
}

function cards(page: VueWrapper) {
	return page.findAll('[data-testid="venue"]');
}

function bodyButton(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((button) =>
		button.textContent?.includes(label),
	);
	if (!found) throw new Error(`ボタンが見つからない: ${label}`);
	return found;
}

beforeEach(() => {
	venues = [aaa, bbb, eee];
	listFails = false;
	vi.clearAllMocks();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/venues（02-screens.md 3.6）', () => {
	it('会場ごとにコード・名前・出どころ・ルート（名前・区間数・片道合計）を出す', async () => {
		const page = await openPage();

		const list = cards(page);
		expect(list).toHaveLength(3);
		expect(list[0]?.text()).toContain('AAA');
		expect(list[0]?.text()).toContain('甲ホール');
		expect(list[0]?.text()).toContain('マスタ由来');
		expect(list[0]?.text()).toContain('乙駅乗換');
		expect(list[0]?.text()).toContain('2区間');
		expect(list[0]?.text()).toContain('530円');
		expect(list[2]?.text()).toContain('自分で追加');
	});

	// 会場名がコードのままの会場に、コードを添えて同じ文字を2つ並べない
	it('会場名がコードと同じなら、コードを二重に出さない', async () => {
		venues = [aaa, fff];
		const page = await openPage();
		const list = cards(page);
		expect(list[0]?.text()).toMatch(/AAA\s*甲ホール/);
		expect(list[1]?.text()).not.toMatch(/FFF\s*FFF/);
		expect(list[1]?.text()).toContain('FFF');
	});

	// 4.3。0本の会場は記録できないので目立たせる
	it('ルートが0本の会場は「ルートなし」と記録できない旨を出す', async () => {
		const page = await openPage();
		const last = cards(page)[2];
		expect(last?.text()).toContain('ルートなし');
		expect(last?.text()).toContain('記録できない');
	});

	it('ルートの行は編集画面へ、「ルートを追加」は会場を選んだ状態の新規画面へ繋がる', async () => {
		const page = await openPage();
		expect(page.find('a[href="/routes/1"]').exists()).toBe(true);
		expect(page.find('a[href="/routes/new?venueId=5"]').exists()).toBe(true);
	});

	// F-38。会場コードでも会場名でも引ける。絞り込みは画面が行う
	it.each([
		['コード', 'bb', ['BBB']],
		['会場名', '甲', ['AAA']],
		['一致なし', 'ZZZ', []],
	])('%s で絞り込める', async (_label, query, expected) => {
		const page = await openPage();
		await page.get('input').setValue(query);
		await nextTick();
		const codes = cards(page).map((card) => card.text().slice(0, 3));
		expect(codes).toEqual(expected);
		if (expected.length === 0) expect(page.text()).toContain('一致する会場はありません');
	});

	it('会場が0件なら、まだ無いことと取り込みの案内を出す', async () => {
		venues = [];
		const page = await openPage();
		expect(page.text()).toContain('まだ会場がありません');
	});

	it('読み込みに失敗したら、空ではなく失敗として出す', async () => {
		listFails = true;
		const page = await openPage();
		expect(page.text()).toContain('読み込めませんでした');
		expect(page.text()).not.toContain('まだ会場がありません');
	});

	it('「会場を追加」でシートが開き、POST が飛んで一覧が増える', async () => {
		const page = await openPage();
		const add = page.findAll('button').find((button) => button.text().includes('会場を追加'));
		await add?.trigger('click');
		await nextTick();
		expect(document.body.textContent).toContain('会場を追加');

		const inputs = [...document.body.querySelectorAll('input')].filter((input) =>
			['DDD', '丁会館'].includes(input.placeholder),
		);
		const [code, name] = inputs;
		if (!code || !name) throw new Error('シートの入力欄が見つからない');
		code.value = 'DDD';
		code.dispatchEvent(new Event('input'));
		name.value = '丁会館';
		name.dispatchEvent(new Event('input'));
		await nextTick();
		bodyButton('追加する').click();
		await vi.waitFor(() => expect(posted).toHaveBeenCalledWith({ code: 'DDD', name: '丁会館' }));
		await vi.waitFor(() => expect(cards(page)).toHaveLength(4));
	});

	// 3.3 と同じく確認を挟む。何が消えて何が残るかを本文に書く
	it('ルートの削除は確認を挟み、確認すると DELETE が飛んで一覧から消える', async () => {
		const page = await openPage();
		const trash = page.find('button[aria-label="乙駅乗換を削除"]');
		await trash.trigger('click');
		await nextTick();
		expect(document.body.textContent).toContain('区間そのものと片道運賃は残る');
		expect(removed).not.toHaveBeenCalled();

		bodyButton('削除する').click();
		await vi.waitFor(() => expect(removed).toHaveBeenCalledWith(1));
		await vi.waitFor(() => expect(cards(page)[0]?.text()).toContain('ルートなし'));
	});

	// F-13。会場マスタを取り込むと一覧が増える
	it('「会場マスタを取り込む」で POST が飛び、一覧が増える', async () => {
		const page = await openPage();
		await page.find('[data-testid="import"]').trigger('click');
		await vi.waitFor(() => expect(imported).toHaveBeenCalled());
		await vi.waitFor(() => expect(cards(page)).toHaveLength(4));
	});
});

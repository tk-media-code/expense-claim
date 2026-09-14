import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody, setResponseStatus, type H3Event } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { Station } from '~/types/station';
import SegmentsPage from './segments.vue';

// 駅名は架空の値だけを使う。実在の駅名は書かない（公開リポジトリ）。
const inUse: Station = { id: 1, name: 'X鉄乙駅', segmentCount: 2 };
const unused: Station = { id: 2, name: 'Y鉄乙駅', segmentCount: 0 };

let stations: Station[] = [];
let listFails = false;
let postFails = false;

const posted = vi.fn<(body: { name: string }) => void>();
const renamed = vi.fn<(to: { id: number; name: string }) => void>();
const removed = vi.fn<(id: number) => void>();

registerEndpoint('/api/stations', {
	method: 'GET',
	handler: (event) => {
		if (listFails) {
			setResponseStatus(event, 500);
			return { error: { code: 'INTERNAL_ERROR', message: '予期しないエラーが発生しました' } };
		}
		return { stations };
	},
});

registerEndpoint('/api/stations', {
	method: 'POST',
	handler: async (event) => {
		const body = await readBody<{ name: string }>(event);
		posted(body);
		if (postFails) {
			setResponseStatus(event, 409);
			return {
				error: { code: 'STATION_NAME_DUPLICATED', message: 'その駅名は既に登録されています' },
			};
		}
		setResponseStatus(event, 201);
		const created = { id: 3, name: body.name, segmentCount: 0 };
		stations = [...stations, created];
		return created;
	},
});

// PUT / DELETE は id ごとのパス。1件ずつ登録する（ワイルドカードは登録できない）。
function detail(id: number) {
	return async (event: H3Event) => {
		if (event.method === 'DELETE') {
			removed(id);
			stations = stations.filter((station) => station.id !== id);
			setResponseStatus(event, 204);
			return null;
		}
		const body = await readBody<{ name: string }>(event);
		renamed({ id, name: body.name });
		stations = stations.map((station) =>
			station.id === id ? { ...station, name: body.name } : station,
		);
		return stations.find((station) => station.id === id);
	};
}

registerEndpoint('/api/stations/1', detail(1));
registerEndpoint('/api/stations/2', detail(2));

let wrapper: VueWrapper | null = null;

async function openPage() {
	wrapper = await mountSuspended(SegmentsPage, { route: '/segments' });
	return wrapper;
}

/** シートは body へ teleport されるので、ページの wrapper からは辿れない */
function sheetText() {
	return document.body.textContent ?? '';
}

/** ページの中のボタン。teleport されたシートとは別に探す */
function pageButton(page: VueWrapper, label: string) {
	const found = page.findAll('button').find((button) => button.text().includes(label));
	if (!found) throw new Error(`ページにボタンが見つからない: ${label}`);
	return found;
}

/** 一覧に出ている駅名。注意書きにも駅名が出るので、行だけを見る */
function listedNames(page: VueWrapper) {
	return page.findAll('ul li').map((row) => row.text());
}

function buttonWith(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((button) =>
		button.textContent?.includes(label),
	);
	if (!found) throw new Error(`ボタンが見つからない: ${label}`);
	return found;
}

function sheetInput(): HTMLInputElement {
	const input = document.body.querySelector('input');
	if (!input) throw new Error('シートの入力欄が見つからない');
	return input;
}

async function type(value: string) {
	const input = sheetInput();
	input.value = value;
	input.dispatchEvent(new Event('input'));
	await nextTick();
}

beforeEach(() => {
	stations = [inUse, unused];
	listFails = false;
	postFails = false;
	vi.clearAllMocks();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/segments の 駅 タブ（02-screens.md 3.8）', () => {
	it('タブに駅の件数を出す。区間には出さない（GET /api/segments は 1-6）', async () => {
		const page = await openPage();

		const tabs = page.findAll('[role="tab"]');
		expect(tabs).toHaveLength(2);
		expect(tabs[0]?.text()).toBe('区間');
		expect(tabs[1]?.text()).toContain('駅');
		expect(tabs[1]?.text()).toContain('2');
	});

	it('一覧が名前と区間数を、サーバーの順序のまま出す', async () => {
		const page = await openPage();

		const rows = listedNames(page);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain('X鉄乙駅');
		expect(rows[0]).toContain('2区間が使っています');
		expect(rows[1]).toContain('Y鉄乙駅');
		expect(rows[1]).toContain('まだどの区間も使っていません');
	});

	it('駅が0件なら、まだ無いことを出す', async () => {
		stations = [];
		const page = await openPage();

		expect(page.text()).toContain('まだ駅がありません');
		expect(page.findAll('ul li')).toHaveLength(0);
	});

	// 空と失敗は別のこと。読み込めなかったのを「まだ駅がありません」と出さない。
	it('読み込みに失敗したら、空ではなく失敗として出す', async () => {
		listFails = true;
		const page = await openPage();

		expect(page.text()).toContain('読み込めませんでした');
		expect(page.text()).not.toContain('まだ駅がありません');
	});

	// 3.8。乗換駅は鉄道会社ごとに別の駅として書かれるので、画面にこの説明を出す。
	it('鉄道会社の略称込みで持つことを画面に出す', async () => {
		const page = await openPage();
		expect(page.text()).toContain('鉄道会社の略称込み');
	});

	it('区間タブは 1-8 の仮置きを出す', async () => {
		const page = await openPage();

		// Reka UI の TabsTrigger が拾うのは mousedown である
		await page.findAll('[role="tab"]')[0]?.trigger('mousedown');
		await nextTick();

		expect(page.text()).toContain('1-8');
	});
});

describe('駅のシート', () => {
	it('駅をタップするとシートが開き、いまの名前が入っている', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();

		expect(sheetText()).toContain('この駅');
		expect(sheetInput().value).toBe('X鉄乙駅');
	});

	// 3.8 の核心。消せないときはボタンを黙って消さず、理由と次の手を出す。
	it('使用中の駅は削除ボタンを出さず、理由を出す', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();

		expect(sheetText()).toContain('2区間がこの駅を使っているので、削除できない');
		expect(sheetText()).toContain('先にその区間を消す');
		expect(() => buttonWith('この駅を削除する')).toThrow();
	});

	it('どの区間も使っていない駅は削除ボタンを出す', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[1]?.trigger('click');
		await nextTick();

		expect(buttonWith('この駅を削除する')).toBeTruthy();
	});

	it('改名すると PUT が飛び、一覧に反映される', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();
		await type('X鉄丙駅');
		buttonWith('この名前で直す').click();
		await vi.waitFor(() => expect(renamed).toHaveBeenCalledWith({ id: 1, name: 'X鉄丙駅' }));

		await vi.waitFor(() => expect(listedNames(page)[0]).toContain('X鉄丙駅'));
	});

	it('削除すると DELETE が飛び、一覧から消える', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[1]?.trigger('click');
		await nextTick();
		buttonWith('この駅を削除する').click();
		await vi.waitFor(() => expect(removed).toHaveBeenCalledWith(2));

		await vi.waitFor(() => expect(listedNames(page)).toEqual([expect.stringContaining('X鉄乙駅')]));
	});

	it('「駅を登録」で POST が飛び、一覧が増える', async () => {
		const page = await openPage();

		await pageButton(page, '駅を登録').trigger('click');
		await nextTick();
		await type('X鉄丙駅');
		buttonWith('登録する').click();
		await vi.waitFor(() => expect(posted).toHaveBeenCalledWith({ name: 'X鉄丙駅' }));

		await vi.waitFor(() => expect(listedNames(page)).toHaveLength(3));
	});

	// 閉じると打った内容ごと消える。失敗の文面は plugins/api.ts がトーストへ出している。
	it('登録が 409 ならシートを閉じず、打った名前を残す', async () => {
		postFails = true;
		const page = await openPage();

		await pageButton(page, '駅を登録').trigger('click');
		await nextTick();
		await type('X鉄乙駅');
		buttonWith('登録する').click();
		await vi.waitFor(() => expect(posted).toHaveBeenCalled());
		await nextTick();

		expect(sheetText()).toContain('駅を登録');
		expect(sheetInput().value).toBe('X鉄乙駅');
	});
});

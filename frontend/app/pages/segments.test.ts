import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody, setResponseStatus, type H3Event } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { Segment } from '~/types/segment';
import type { Station } from '~/types/station';
import SegmentsPage from './segments.vue';

// 駅名は架空の値だけを使う。実在の駅名は書かない（公開リポジトリ）。
const inUse: Station = { id: 1, name: 'X鉄乙駅', segmentCount: 2 };
const unused: Station = { id: 2, name: 'Y鉄乙駅', segmentCount: 0 };
const third: Station = { id: 3, name: 'Z鉄丙駅', segmentCount: 0 };

const sharedSegment: Segment = {
	id: 10,
	fromStationId: 1,
	fromStationName: 'X鉄乙駅',
	toStationId: 3,
	toStationName: 'Z鉄丙駅',
	oneWayFare: 320,
	routeCount: 2,
};
const unusedSegment: Segment = {
	id: 11,
	fromStationId: 1,
	fromStationName: 'X鉄乙駅',
	toStationId: 2,
	toStationName: 'Y鉄乙駅',
	oneWayFare: 210,
	routeCount: 0,
};

let stations: Station[] = [];
let segments: Segment[] = [];
let stationsFail = false;
let segmentsFail = false;
let postFails = false;

const stationPosted = vi.fn<(body: { name: string }) => void>();
const stationRenamed = vi.fn<(to: { id: number; name: string }) => void>();
const stationRemoved = vi.fn<(id: number) => void>();
const segmentPosted = vi.fn<(body: Record<string, unknown>) => void>();
const segmentPut = vi.fn<(id: number, body: Record<string, unknown>) => void>();
const segmentRemoved = vi.fn<(id: number) => void>();

function failure(event: H3Event, status: number, code: string, message: string) {
	setResponseStatus(event, status);
	return { error: { code, message } };
}

registerEndpoint('/api/stations', {
	method: 'GET',
	handler: (event) =>
		stationsFail
			? failure(event, 500, 'INTERNAL_ERROR', '予期しないエラーが発生しました')
			: { stations },
});

registerEndpoint('/api/stations', {
	method: 'POST',
	handler: async (event) => {
		const body = await readBody<{ name: string }>(event);
		stationPosted(body);
		if (postFails) {
			return failure(event, 409, 'STATION_NAME_DUPLICATED', 'その駅名は既に登録されています');
		}
		setResponseStatus(event, 201);
		const created = { id: 4, name: body.name, segmentCount: 0 };
		stations = [...stations, created];
		return created;
	},
});

// PUT / DELETE は id ごとのパス。1件ずつ登録する（ワイルドカードは登録できない）。
function stationDetail(id: number) {
	return async (event: H3Event) => {
		if (event.method === 'DELETE') {
			stationRemoved(id);
			stations = stations.filter((station) => station.id !== id);
			setResponseStatus(event, 204);
			return null;
		}
		const body = await readBody<{ name: string }>(event);
		stationRenamed({ id, name: body.name });
		stations = stations.map((station) =>
			station.id === id ? { ...station, name: body.name } : station,
		);
		return stations.find((station) => station.id === id);
	};
}
registerEndpoint('/api/stations/1', stationDetail(1));
registerEndpoint('/api/stations/2', stationDetail(2));

registerEndpoint('/api/segments', {
	method: 'GET',
	handler: (event) =>
		segmentsFail
			? failure(event, 500, 'INTERNAL_ERROR', '予期しないエラーが発生しました')
			: { segments },
});

registerEndpoint('/api/segments', {
	method: 'POST',
	handler: async (event) => {
		const body = await readBody<Record<string, unknown>>(event);
		segmentPosted(body);
		if (postFails) {
			return failure(event, 409, 'SEGMENT_DUPLICATED', 'その区間は既に登録されています');
		}
		setResponseStatus(event, 201);
		const created: Segment = {
			id: 12,
			fromStationId: Number(body.fromStationId),
			fromStationName: 'Y鉄乙駅',
			toStationId: Number(body.toStationId),
			toStationName: 'Z鉄丙駅',
			oneWayFare: Number(body.oneWayFare),
			routeCount: 0,
		};
		segments = [...segments, created];
		return created;
	},
});

function segmentDetail(id: number) {
	return async (event: H3Event) => {
		if (event.method === 'DELETE') {
			segmentRemoved(id);
			segments = segments.filter((segment) => segment.id !== id);
			setResponseStatus(event, 204);
			return null;
		}
		const body = await readBody<Record<string, unknown>>(event);
		segmentPut(id, body);
		segments = segments.map((segment) =>
			segment.id === id ? { ...segment, oneWayFare: Number(body.oneWayFare) } : segment,
		);
		return segments.find((segment) => segment.id === id);
	};
}
registerEndpoint('/api/segments/10', segmentDetail(10));
registerEndpoint('/api/segments/11', segmentDetail(11));

let wrapper: VueWrapper | null = null;

async function openPage(tab: 'segment' | 'station' = 'segment') {
	wrapper = await mountSuspended(SegmentsPage, { route: '/segments' });
	if (tab === 'station') {
		// Reka UI の TabsTrigger が拾うのは mousedown である
		await wrapper.findAll('[role="tab"]')[1]?.trigger('mousedown');
		await nextTick();
	}
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

/** 一覧の行。注意書きにも駅名が出るので、行だけを見る */
function listedRows(page: VueWrapper) {
	return page.findAll('ul li').map((row) => row.text());
}

function buttonWith(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((button) =>
		button.textContent?.includes(label),
	);
	if (!found) throw new Error(`ボタンが見つからない: ${label}`);
	return found;
}

function sheetInput(selector = 'input'): HTMLInputElement {
	const input = document.body.querySelector<HTMLInputElement>(selector);
	if (!input) throw new Error(`シートの入力欄が見つからない: ${selector}`);
	return input;
}

async function type(value: string, selector = 'input') {
	const input = sheetInput(selector);
	input.value = value;
	input.dispatchEvent(new Event('input'));
	await nextTick();
}

/** 駅の選択欄。USelectMenu の中身は Reka UI なので、モデル値を直接入れる */
async function pickStation(page: VueWrapper, label: string, id: number) {
	const picker = page
		.findAllComponents({ name: 'StationPicker' })
		.find((component) => component.props('label') === label);
	if (!picker) throw new Error(`駅の選択欄が見つからない: ${label}`);
	picker.vm.$emit('update:modelValue', id);
	await nextTick();
}

beforeEach(() => {
	stations = [inUse, unused, third];
	segments = [sharedSegment, unusedSegment];
	stationsFail = false;
	segmentsFail = false;
	postFails = false;
	vi.clearAllMocks();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/segments のタブ（02-screens.md 3.8）', () => {
	it('タブに区間と駅の件数を出し、既定は区間', async () => {
		const page = await openPage();

		const tabs = page.findAll('[role="tab"]');
		expect(tabs).toHaveLength(2);
		expect(tabs[0]?.text()).toContain('区間');
		expect(tabs[0]?.text()).toContain('2');
		expect(tabs[1]?.text()).toContain('駅');
		expect(tabs[1]?.text()).toContain('3');
		expect(page.find('[data-testid="segment-tab"]').exists()).toBe(true);
	});
});

describe('区間タブ', () => {
	it('一覧が「出発駅 → 到着駅」・運賃・使っているルート数を、サーバーの順序のまま出す', async () => {
		const page = await openPage();

		const rows = listedRows(page);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain('X鉄乙駅 → Z鉄丙駅');
		expect(rows[0]).toContain('320円');
		expect(rows[0]).toContain('2本のルートが使っています');
		expect(rows[1]).toContain('X鉄乙駅 → Y鉄乙駅');
		expect(rows[1]).toContain('まだどのルートも使っていません');
	});

	it('区間が0件なら、まだ無いことを出す', async () => {
		segments = [];
		const page = await openPage();
		expect(page.text()).toContain('まだ区間がありません');
	});

	// 空と失敗は別のこと。読み込めなかったのを「まだ区間がありません」と出さない。
	it('読み込みに失敗したら、空ではなく失敗として出す', async () => {
		segmentsFail = true;
		const page = await openPage();
		expect(page.text()).toContain('読み込めませんでした');
		expect(page.text()).not.toContain('まだ区間がありません');
	});

	// 3.8 の核心。使用中は運賃だけ直せ、駅の差し替えと削除は理由を出して塞ぐ
	it('使用中の区間のシートは駅の欄と削除ボタンを出さず、理由を出す', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();

		expect(sheetText()).toContain('この区間');
		expect(sheetText()).toContain(
			'2本のルートがこの区間を使っているので、出発駅・到着駅は変えられない',
		);
		expect(sheetText()).toContain('先にそのルートからこの区間を外す');
		expect(page.findAllComponents({ name: 'StationPicker' })).toHaveLength(0);
		expect(() => buttonWith('この区間を削除する')).toThrow();
		expect(sheetInput('input[inputmode="numeric"]').value).toBe('320');
	});

	it('未使用の区間のシートは駅の選択欄と削除ボタンを出す', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[1]?.trigger('click');
		await nextTick();

		expect(page.findAllComponents({ name: 'StationPicker' })).toHaveLength(2);
		expect(buttonWith('この区間を削除する')).toBeTruthy();
	});

	// 決定18。運賃改定はここだけで終わる。使用中なら oneWayFare だけを送る（駅を送れば 409）
	it('使用中の区間の運賃を直すと oneWayFare だけの PUT が飛び、一覧に反映される', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();
		await type('330', 'input[inputmode="numeric"]');
		buttonWith('この内容で直す').click();
		await vi.waitFor(() => expect(segmentPut).toHaveBeenCalledWith(10, { oneWayFare: 330 }));

		await vi.waitFor(() => expect(listedRows(page)[0]).toContain('330円'));
	});

	it('未使用の区間は駅ごと直せ、駅を含む PUT が飛ぶ', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[1]?.trigger('click');
		await nextTick();
		await pickStation(page, '到着駅', 3);
		buttonWith('この内容で直す').click();
		await vi.waitFor(() =>
			expect(segmentPut).toHaveBeenCalledWith(11, {
				fromStationId: 1,
				toStationId: 3,
				oneWayFare: 210,
			}),
		);
	});

	it('削除すると DELETE が飛び、一覧から消える', async () => {
		const page = await openPage();

		await page.findAll('ul li button')[1]?.trigger('click');
		await nextTick();
		buttonWith('この区間を削除する').click();
		await vi.waitFor(() => expect(segmentRemoved).toHaveBeenCalledWith(11));

		await vi.waitFor(() => expect(listedRows(page)).toHaveLength(1));
	});

	it('「区間を追加」で駅を選び運賃を入れると POST が飛び、一覧が増える', async () => {
		const page = await openPage();

		await pageButton(page, '区間を追加').trigger('click');
		await nextTick();
		expect(sheetText()).toContain('区間を追加');
		await pickStation(page, '出発駅', 2);
		await pickStation(page, '到着駅', 3);
		await type('500', 'input[inputmode="numeric"]');
		buttonWith('登録する').click();
		await vi.waitFor(() =>
			expect(segmentPosted).toHaveBeenCalledWith({
				fromStationId: 2,
				toStationId: 3,
				oneWayFare: 500,
			}),
		);

		await vi.waitFor(() => expect(listedRows(page)).toHaveLength(3));
	});

	// 閉じると打った内容ごと消える。失敗の文面は plugins/api.ts がトーストへ出している。
	it('登録が 409 ならシートを閉じず、打った運賃を残す', async () => {
		postFails = true;
		const page = await openPage();

		await pageButton(page, '区間を追加').trigger('click');
		await nextTick();
		await pickStation(page, '出発駅', 1);
		await pickStation(page, '到着駅', 3);
		await type('320', 'input[inputmode="numeric"]');
		buttonWith('登録する').click();
		await vi.waitFor(() => expect(segmentPosted).toHaveBeenCalled());
		await nextTick();

		expect(sheetText()).toContain('区間を追加');
		expect(sheetInput('input[inputmode="numeric"]').value).toBe('320');
	});

	// 3.8。駅が無いというだけで区間の入力を捨てさせない。駅のシートを重ねて出し、登録した駅が選ばれる
	it('区間のシートから駅を登録すると、その駅が選択され、駅一覧も取り直される', async () => {
		const page = await openPage();

		await pageButton(page, '区間を追加').trigger('click');
		await nextTick();
		await type('500', 'input[inputmode="numeric"]');

		const addStation = [...document.body.querySelectorAll('button')].find(
			(button) => button.getAttribute('aria-label') === '出発駅を登録',
		);
		if (!addStation) throw new Error('出発駅を登録するボタンが見つからない');
		addStation.click();
		await nextTick();
		expect(sheetText()).toContain('駅を登録');

		const nameInput = [...document.body.querySelectorAll('input')].find(
			(input) => input.placeholder === 'XX鉄〇〇駅',
		);
		if (!nameInput) throw new Error('駅名の入力欄が見つからない');
		nameInput.value = 'X鉄辛駅';
		nameInput.dispatchEvent(new Event('input'));
		await nextTick();
		// 「登録する」は区間のシートにもある。重ねて出た駅のシートは DOM の後ろにある
		const registerButtons = [...document.body.querySelectorAll('button')].filter((button) =>
			button.textContent?.includes('登録する'),
		);
		registerButtons[registerButtons.length - 1]?.click();
		await vi.waitFor(() => expect(stationPosted).toHaveBeenCalledWith({ name: 'X鉄辛駅' }));

		// 登録した駅（id 4）が出発駅に選ばれ、打ちかけの運賃は残っている
		const from = page
			.findAllComponents({ name: 'StationPicker' })
			.find((component) => component.props('label') === '出発駅');
		await vi.waitFor(() => expect(from?.props('modelValue')).toBe(4));
		expect(sheetInput('input[inputmode="numeric"]').value).toBe('500');
	});
});

describe('駅タブ', () => {
	it('一覧が名前と区間数を、サーバーの順序のまま出す', async () => {
		const page = await openPage('station');

		const rows = listedRows(page);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toContain('X鉄乙駅');
		expect(rows[0]).toContain('2区間が使っています');
		expect(rows[1]).toContain('Y鉄乙駅');
		expect(rows[1]).toContain('まだどの区間も使っていません');
	});

	it('駅が0件なら、まだ無いことを出す', async () => {
		stations = [];
		const page = await openPage('station');

		expect(page.text()).toContain('まだ駅がありません');
		expect(page.findAll('ul li')).toHaveLength(0);
	});

	// 空と失敗は別のこと。読み込めなかったのを「まだ駅がありません」と出さない。
	it('読み込みに失敗したら、空ではなく失敗として出す', async () => {
		stationsFail = true;
		const page = await openPage('station');

		expect(page.text()).toContain('読み込めませんでした');
		expect(page.text()).not.toContain('まだ駅がありません');
	});
});

describe('駅のシート', () => {
	it('駅をタップするとシートが開き、いまの名前が入っている', async () => {
		const page = await openPage('station');

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();

		expect(sheetText()).toContain('この駅');
		expect(sheetInput().value).toBe('X鉄乙駅');
	});

	// 3.8 の核心。消せないときはボタンを黙って消さず、理由と次の手を出す。
	it('使用中の駅は削除ボタンを出さず、理由を出す', async () => {
		const page = await openPage('station');

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();

		expect(sheetText()).toContain('2区間がこの駅を使っているので、削除できない');
		expect(sheetText()).toContain('先にその区間を消す');
		expect(() => buttonWith('この駅を削除する')).toThrow();
	});

	it('どの区間も使っていない駅は削除ボタンを出す', async () => {
		const page = await openPage('station');

		await page.findAll('ul li button')[1]?.trigger('click');
		await nextTick();

		expect(buttonWith('この駅を削除する')).toBeTruthy();
	});

	it('改名すると PUT が飛び、一覧に反映される', async () => {
		const page = await openPage('station');

		await page.findAll('ul li button')[0]?.trigger('click');
		await nextTick();
		await type('X鉄丙駅');
		buttonWith('この名前で直す').click();
		await vi.waitFor(() => expect(stationRenamed).toHaveBeenCalledWith({ id: 1, name: 'X鉄丙駅' }));

		await vi.waitFor(() => expect(listedRows(page)[0]).toContain('X鉄丙駅'));
	});

	it('削除すると DELETE が飛び、一覧から消える', async () => {
		const page = await openPage('station');

		await page.findAll('ul li button')[1]?.trigger('click');
		await nextTick();
		buttonWith('この駅を削除する').click();
		await vi.waitFor(() => expect(stationRemoved).toHaveBeenCalledWith(2));

		await vi.waitFor(() => expect(listedRows(page)).toHaveLength(2));
	});

	it('「駅を登録」で POST が飛び、一覧が増える', async () => {
		const page = await openPage('station');

		await pageButton(page, '駅を登録').trigger('click');
		await nextTick();
		await type('X鉄丙駅');
		buttonWith('登録する').click();
		await vi.waitFor(() => expect(stationPosted).toHaveBeenCalledWith({ name: 'X鉄丙駅' }));

		await vi.waitFor(() => expect(listedRows(page)).toHaveLength(4));
	});

	// 閉じると打った内容ごと消える。失敗の文面は plugins/api.ts がトーストへ出している。
	it('登録が 409 ならシートを閉じず、打った名前を残す', async () => {
		postFails = true;
		const page = await openPage('station');

		await pageButton(page, '駅を登録').trigger('click');
		await nextTick();
		await type('X鉄乙駅');
		buttonWith('登録する').click();
		await vi.waitFor(() => expect(stationPosted).toHaveBeenCalled());
		await nextTick();

		expect(sheetText()).toContain('駅を登録');
		expect(sheetInput().value).toBe('X鉄乙駅');
	});
});

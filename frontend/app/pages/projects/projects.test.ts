import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody, setResponseStatus, type H3Event } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { ProjectDetail } from '~/types/project';
import type { Venue } from '~/types/venue';
import DetailPage from './[id]/index.vue';
import NewPage from './new.vue';

// 案件・会場は架空の値だけを使う（公開リポジトリ）
const venues: Venue[] = [
	{ id: 1, code: 'AAA', name: '甲ホール', source: 'master', routes: [] },
	{ id: 2, code: 'BBB', name: '乙迎賓館', source: 'master', routes: [] },
];
const existing: ProjectDetail = {
	id: 3,
	projectNo: '100000001',
	serviceDate: '2026-09-05',
	month: '2026-09',
	venueCode: 'AAA',
	venueName: '甲ホール',
	coupleName: '〇〇様△△様',
	source: 'mail',
	record: null,
	taxiCount: 0,
};

let project: ProjectDetail;
const posted = vi.fn<(body: Record<string, unknown>) => void>();
const patched = vi.fn<(body: Record<string, unknown>) => void>();
const removed = vi.fn<() => void>();

registerEndpoint('/api/venues', { method: 'GET', handler: () => ({ venues }) });
registerEndpoint('/api/projects', {
	method: 'POST',
	handler: async (event) => {
		const body = await readBody<Record<string, unknown>>(event);
		posted(body);
		setResponseStatus(event, 201);
		return { id: 9, ...body, month: '2026-09', venueName: '甲ホール', source: 'manual' };
	},
});
registerEndpoint('/api/projects/3', async (event: H3Event) => {
	if (event.method === 'DELETE') {
		removed();
		setResponseStatus(event, 204);
		return null;
	}
	if (event.method === 'PATCH') {
		const body = await readBody<Record<string, unknown>>(event);
		patched(body);
		project = { ...project, ...body } as ProjectDetail;
	}
	return project;
});

let wrapper: VueWrapper | null = null;

function bodyButton(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((button) =>
		button.textContent?.includes(label),
	);
	if (!found) throw new Error(`ボタンが見つからない: ${label}`);
	return found;
}

function input(page: VueWrapper, label: string) {
	return page.get<HTMLInputElement>(`input[aria-label="${label}"]`);
}

async function pickVenue(page: VueWrapper, code: string) {
	page.findComponent({ name: 'USelectMenu' }).vm.$emit('update:modelValue', code);
	await nextTick();
}

beforeEach(() => {
	vi.useFakeTimers({ now: new Date('2026-09-05T10:00:00Z'), toFake: ['Date'] });
	project = { ...existing };
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
	wrapper?.unmount();
	wrapper = null;
});

describe('/projects/new（02-screens.md 3.4）', () => {
	it('案件番号が必須である旨を出し、4項目を入れて POST が飛ぶ', async () => {
		wrapper = await mountSuspended(NewPage, { route: '/projects/new' });
		await nextTick();
		expect(wrapper.text()).toContain('案件番号はそこに書かれている');

		await input(wrapper, '施行日').setValue('2026-09-12');
		await pickVenue(wrapper, 'AAA');
		await input(wrapper, 'ご両家名').setValue('××様＋＋様');
		await input(wrapper, '案件番号').setValue('100000003');
		await wrapper.get('form').trigger('submit');
		await vi.waitFor(() =>
			expect(posted).toHaveBeenCalledWith({
				projectNo: '100000003',
				serviceDate: '2026-09-12',
				venueCode: 'AAA',
				coupleName: '××様＋＋様',
			}),
		);
	});
});

describe('/projects/:id（02-screens.md 3.3）', () => {
	it('項目を出し、入力欄にいまの値が入っている', async () => {
		wrapper = await mountSuspended(DetailPage, { route: '/projects/3' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('甲ホール'));
		expect(wrapper.text()).toContain('9/5（土）');
		expect(wrapper.text()).toContain('自動取込');
		expect(input(wrapper, '施行日').element.value).toBe('2026-09-05');
		expect(input(wrapper, 'ご両家名').element.value).toBe('〇〇様△△様');
		expect(input(wrapper, '案件番号').element.value).toBe('100000001');
	});

	// 2.3 / 3.5。詳細から開くときは ?from=detail を付け、詳細へ戻る
	it('施行済みなら「記録する」が from=detail 付きで記録画面へ繋がる', async () => {
		wrapper = await mountSuspended(DetailPage, { route: '/projects/3' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('甲ホール'));
		expect(wrapper.find('a[href="/projects/3/record?from=detail"]').exists()).toBe(true);
	});

	// 3.3。記録済みなら要約（合計・ルート名）が出て、直す入口になる
	it('記録済みなら要約を出し、「記録を直す」が記録画面へ繋がる', async () => {
		project = {
			...existing,
			record: {
				tripType: 'one_way',
				total: 1110,
				outboundRouteName: '丁駅乗換',
				returnRouteName: '戊駅直通',
				recordedAt: '2026-09-05T10:03:00Z',
			},
		};
		wrapper = await mountSuspended(DetailPage, { route: '/projects/3' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('甲ホール'));
		const summary = wrapper.find('[data-testid="record-summary"]').text();
		expect(summary).toContain('1,110円');
		expect(summary).toContain('往路 丁駅乗換 ／ 復路 戊駅直通');
		expect(summary).toContain('記録を直す');
	});

	// 3.3「ただし記録が既にあるなら押せる」。施行日を後から未来へ直した案件が、直せないまま残らない
	it('施行前でも記録があれば「記録を直す」を押せる', async () => {
		project = {
			...existing,
			serviceDate: '2026-09-06',
			record: {
				tripType: 'round',
				total: 1060,
				outboundRouteName: '乙駅乗換',
				returnRouteName: '乙駅乗換',
				recordedAt: '2026-09-05T10:03:00Z',
			},
		};
		wrapper = await mountSuspended(DetailPage, { route: '/projects/3' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('甲ホール'));
		expect(wrapper.find('a[href="/projects/3/record?from=detail"]').exists()).toBe(true);
	});

	// 3.3。施行前の案件では「記録する」を押せない。理由を添える
	it('施行前なら「記録する」を押せず、理由を出す', async () => {
		project = { ...existing, serviceDate: '2026-09-06' };
		wrapper = await mountSuspended(DetailPage, { route: '/projects/3' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('甲ホール'));
		expect(wrapper.find('[data-testid="record"]').attributes('disabled')).toBeDefined();
		expect(wrapper.text()).toContain('施行前なので、まだ記録できない');
	});

	it('項目を直すと PATCH が飛ぶ', async () => {
		wrapper = await mountSuspended(DetailPage, { route: '/projects/3' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('甲ホール'));
		await input(wrapper, '施行日').setValue('2026-10-03');
		await wrapper.get('form').trigger('submit');
		await vi.waitFor(() =>
			expect(patched).toHaveBeenCalledWith({
				projectNo: '100000001',
				serviceDate: '2026-10-03',
				venueCode: 'AAA',
				coupleName: '〇〇様△△様',
			}),
		);
	});

	// 3.3。確認ダイアログにこの2つを書く
	it('削除は確認を挟み、記録も消えることとドライブの実体は消えないことを書く', async () => {
		wrapper = await mountSuspended(DetailPage, { route: '/projects/3' });
		await vi.waitFor(() => expect(wrapper!.text()).toContain('甲ホール'));
		wrapper
			.findAll('button')
			.find((b) => b.text().includes('この案件を削除する'))
			?.element.click();
		await nextTick();
		expect(document.body.textContent).toContain('領収書のレコードも消える');
		expect(document.body.textContent).toContain('ファイルは消えない');
		expect(removed).not.toHaveBeenCalled();
		bodyButton('削除する').click();
		await vi.waitFor(() => expect(removed).toHaveBeenCalled());
	});
});

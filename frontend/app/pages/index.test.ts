import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { setResponseStatus } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Home, HomeProject } from '~/types/home';
import HomePage from './index.vue';

// 案件は架空の値だけを使う（公開リポジトリ）。02-screens.md 2.4 の場面「稼働日の帰り道」（今日 9/5）に合わせる
function project(
	id: number,
	serviceDate: string,
	venue: string,
	extra: Partial<HomeProject> = {},
): HomeProject {
	return {
		id,
		projectNo: `10000000${id}`,
		serviceDate,
		venueCode: venue,
		venueName: `${venue}会場`,
		coupleName: '〇〇様△△様',
		recorded: false,
		totalAmount: null,
		taxiCount: 0,
		...extra,
	};
}

let home: Home;
let fails = false;

registerEndpoint('/api/home', {
	method: 'GET',
	handler: (event) => {
		if (fails) {
			setResponseStatus(event, 500);
			return { error: { code: 'INTERNAL_ERROR', message: '予期しないエラーが発生しました' } };
		}
		return home;
	},
});

let wrapper: VueWrapper | null = null;

async function openPage() {
	wrapper = await mountSuspended(HomePage, { route: '/' });
	return wrapper;
}

function cards(page: VueWrapper) {
	return page.findAll('[data-testid="project"]');
}

beforeEach(() => {
	vi.useFakeTimers({ now: new Date('2026-09-05T10:00:00Z'), toFake: ['Date'] });
	fails = false;
	home = {
		targetMonth: '2026-08',
		lastImportedAt: '2026-09-05T09:42:00Z',
		lastCronRunAt: '2026-09-04T22:00:00Z',
		attentionCount: 0,
		months: [
			{
				month: '2026-09',
				state: 'upcoming',
				submittedAt: null,
				projects: [
					project(3, '2026-09-05', 'AAA'),
					project(4, '2026-09-05', 'BBB'),
					project(5, '2026-09-06', 'EEE'),
					project(6, '2026-09-12', 'AAA'),
				],
			},
			{
				month: '2026-08',
				state: 'due',
				submittedAt: null,
				projects: [
					project(1, '2026-08-22', 'CCC', { recorded: true, totalAmount: 1040 }),
					project(2, '2026-08-23', 'DDD', { recorded: true, totalAmount: 1520, taxiCount: 1 }),
				],
			},
		],
	};
});

afterEach(() => {
	vi.useRealTimers();
	wrapper?.unmount();
	wrapper = null;
});

describe('/（02-screens.md 3.2）', () => {
	// 4.2。月度ごとに区切り、見出しに状態を添える。並びはサーバーのまま
	it('月度ごとに区切り、見出しに状態を出す', async () => {
		const page = await openPage();
		const months = page.findAll('[data-testid="month"]');
		expect(months).toHaveLength(2);
		expect(months[0]?.find('h2').text()).toContain('2026年9月度');
		expect(months[0]?.find('h2').text()).toContain('これから稼働');
		expect(months[1]?.find('h2').text()).toContain('2026年8月度');
		expect(months[1]?.find('h2').text()).toContain('提出待ち');
	});

	// 2.3。押す前にカードで施行日・会場名・ご両家名が見える
	it('案件カードに施行日・会場名・ご両家名を出し、本体は詳細へ繋がる', async () => {
		const page = await openPage();
		const first = cards(page)[0];
		expect(first?.text()).toContain('9/5（土）');
		expect(first?.text()).toContain('AAA会場');
		expect(first?.text()).toContain('〇〇様△△様');
		expect(first?.find('a[href="/projects/3"]').exists()).toBe(true);
	});

	// 3.2 / 4.1。「記録する」は施行済みで未記録のカードにだけ。施行前・記録済みはバッジで理由が分かる
	it('「記録する」は今日までの未記録の案件にだけ出し、施行前と記録済みはバッジを出す', async () => {
		const page = await openPage();
		const [today1, today2, tomorrow, nextWeek, recorded, withTaxi] = cards(page);

		expect(today1?.find('a[href="/projects/3/record"]').exists()).toBe(true);
		expect(today1?.text()).toContain('未記録');
		expect(today2?.find('a[href="/projects/4/record"]').exists()).toBe(true);

		expect(tomorrow?.text()).toContain('施行前');
		expect(tomorrow?.find('a[href="/projects/5/record"]').exists()).toBe(false);
		expect(nextWeek?.text()).toContain('施行前');

		expect(recorded?.text()).toContain('記録済み');
		expect(recorded?.text()).toContain('1,040円');
		expect(recorded?.find('a[href="/projects/1/record"]').exists()).toBe(false);
		expect(recorded?.text()).not.toContain('タクシー');
		expect(withTaxi?.text()).toContain('タクシー1回');
	});

	it('対象月度に記録済みの案件があれば「提出」が押せる', async () => {
		const page = await openPage();
		expect(page.find('[data-testid="submit"]').attributes('disabled')).toBeUndefined();
		expect(page.text()).not.toContain('提出できるものがありません');
	});

	// 3.2。押せない理由を添える。理由の見えない非活性は故障と区別がつかない
	it('対象月度に記録済みの案件が無ければ「提出」を非活性にし、理由を出す', async () => {
		home.months[1]!.projects = home.months[1]!.projects.map((p) => ({
			...p,
			recorded: false,
			totalAmount: null,
		}));
		const page = await openPage();
		expect(page.find('[data-testid="submit"]').attributes('disabled')).toBeDefined();
		expect(page.text()).toContain('提出できるものがありません');
	});

	// 4.4。0件なら出さない
	it('要確認事項は0件なら出さず、あれば件数を出す', async () => {
		const page = await openPage();
		expect(page.find('[data-testid="attention-count"]').exists()).toBe(false);
		wrapper?.unmount();

		home.attentionCount = 3;
		const again = await openPage();
		expect(again.find('[data-testid="attention-count"]').text()).toContain('3件');
	});

	// 要件定義 10章 / 06-error-handling.md 7.2。静かな故障に気づく手立て。cron は2日空けば目立たせる
	it('最後に取り込んだ日時と cron の日時を JST で出し、cron が2日以上前なら目立たせる', async () => {
		const page = await openPage();
		const info = page.find('[data-testid="sync-info"]').text();
		expect(info).toContain('9/5 18:42');
		expect(info).toContain('9/5 07:00');
		expect(info).not.toContain('止まっている');
		wrapper?.unmount();

		home.lastCronRunAt = '2026-09-02T22:00:00Z';
		const stale = await openPage();
		expect(stale.find('[data-testid="sync-info"]').text()).toContain('止まっている可能性');
	});

	it('案件が無ければその旨を出す', async () => {
		home.months = [];
		const page = await openPage();
		expect(page.text()).toContain('案件がありません');
	});

	it('読み込みに失敗したら失敗として出す', async () => {
		fails = true;
		const page = await openPage();
		expect(page.text()).toContain('読み込めませんでした');
	});
});

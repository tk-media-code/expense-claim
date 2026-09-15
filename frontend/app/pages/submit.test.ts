import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody, setResponseStatus } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubmissionPreview } from '~/types/submission';
import SubmitPage from './submit.vue';

// 要件定義 5.6 の架空の例（2026年9月分・3案件・7行）
const rows: SubmissionPreview['rows'] = [
	{
		no: 1,
		projectId: 1,
		cells: {
			A: '2026/9/5',
			B: 'AAA',
			C: '婚礼案件',
			D: '〇〇様△△様',
			E: 'X鉄甲駅',
			F: 'X鉄乙駅',
			G: '往復',
			H: 640,
			I: 3200,
		},
	},
	{
		no: 2,
		projectId: 1,
		cells: {
			A: null,
			B: null,
			C: null,
			D: null,
			E: 'Y鉄乙駅',
			F: 'Y鉄丙駅',
			G: '往復',
			H: 420,
			I: null,
		},
	},
	{
		no: 3,
		projectId: 2,
		cells: {
			A: '2026/9/5',
			B: 'BBB',
			C: '婚礼案件',
			D: '□□様◇◇様',
			E: 'X鉄甲駅',
			F: 'X鉄丁駅',
			G: '片道',
			H: 380,
			I: null,
		},
	},
];

let preview: SubmissionPreview;
let previewFails: { status: number; code: string; message: string } | null;
let executeFails: { status: number; code: string; message: string } | null;
const executed = vi.fn<(body: unknown) => void>();

registerEndpoint('/api/submissions/preview', {
	method: 'POST',
	handler: (event) => {
		if (previewFails) {
			setResponseStatus(event, previewFails.status);
			return { error: { code: previewFails.code, message: previewFails.message } };
		}
		return preview;
	},
});
registerEndpoint('/api/submissions', {
	method: 'POST',
	handler: async (event) => {
		executed(await readBody(event));
		if (executeFails) {
			setResponseStatus(event, executeFails.status);
			return { error: { code: executeFails.code, message: executeFails.message } };
		}
		return { writtenRows: 3, rowsInserted: 0, warnings: [] };
	},
});

let wrapper: VueWrapper | null = null;

async function openPage() {
	wrapper = await mountSuspended(SubmitPage, { route: '/submit' });
	return wrapper;
}

beforeEach(() => {
	preview = {
		targetMonth: '2026-09',
		lastSubmittedAt: null,
		attentionCount: 0,
		rows,
		receiptCell:
			'(9/5)\nhttps://drive.google.com/file/d/r1/view\nhttps://drive.google.com/file/d/r2/view',
		writableRows: 25,
		rowsToInsert: 0,
		warnings: [],
	};
	previewFails = null;
	executeFails = null;
	vi.clearAllMocks();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/submit（02-screens.md 3.9）', () => {
	// F-27 / R-17。書き込む形のまま。2行目以降の A〜D が空であることまで確認の対象
	it('確認の段で、対象月度・行の一覧（A〜I そのまま）・領収書欄・前回の提出を出す', async () => {
		const page = await openPage();
		await vi.waitFor(() => expect(page.find('[data-testid="rows"]').exists()).toBe(true));
		expect(page.text()).toContain('2026年9月度の提出');
		expect(page.find('[data-testid="last-submitted"]').text()).toContain('まだ提出していない');
		const trs = page.findAll('[data-testid="rows"] tbody tr');
		expect(trs).toHaveLength(3);
		expect(trs[0]?.text()).toContain('2026/9/5');
		expect(trs[0]?.text()).toContain('3200');
		const secondCells = trs[1]?.findAll('td').map((td) => td.text()) ?? [];
		expect(secondCells.slice(1, 5)).toEqual(['', '', '', '']);
		expect(secondCells[5]).toBe('Y鉄乙駅');
		// J〜L は出さない
		expect(page.findAll('[data-testid="rows"] thead th')).toHaveLength(10);
		expect(page.find('[data-testid="receipt-cell"]').text()).toContain('(9/5)');
		// 片道が現れる案件は目視できる
		expect(page.find('[data-testid="one-way"]').exists()).toBe(true);
		expect(page.find('[data-testid="submit"]').attributes('disabled')).toBeUndefined();
	});

	it('警告・挿入する行数・要確認件数を出す', async () => {
		preview = {
			...preview,
			rowsToInsert: 5,
			writableRows: 25,
			attentionCount: 2,
			warnings: [
				{
					code: 'VENUE_CODE_UNKNOWN',
					message: '会場コード BBB が会場マスタにありません',
					projectId: 2,
				},
				{
					code: 'NO_EXPENSE_RECORD',
					message: '2026/9/12 甲ホール は交通費の記録がありません。この案件は書き込みません',
					projectId: 3,
				},
			],
		};
		const page = await openPage();
		await vi.waitFor(() => expect(page.find('[data-testid="warnings"]').exists()).toBe(true));
		expect(page.find('[data-testid="warnings"]').text()).toContain('会場コード BBB');
		expect(page.find('[data-testid="warnings"]').text()).toContain('書き込みません');
		expect(page.find('[data-testid="rows-to-insert"]').text()).toContain('5 行足りない');
		expect(page.text()).toContain('要確認事項が 2 件');
	});

	// 3.9 / 3.2。書き込む行が0行なら押せない。理由を添える
	it('書き込む行が無ければ「提出する」を押せず、理由を出す', async () => {
		preview = { ...preview, rows: [], receiptCell: '' };
		const page = await openPage();
		await vi.waitFor(() => expect(page.find('[data-testid="submit"]').exists()).toBe(true));
		expect(page.find('[data-testid="submit"]').attributes('disabled')).toBeDefined();
		expect(page.text()).toContain('書き込む行が無いので、提出できません');
	});

	// 04-api.md 6.2。本文は確認した対象月度だけ
	it('「提出する」で確認した対象月度だけを送り、結果を出す', async () => {
		const page = await openPage();
		await vi.waitFor(() => expect(page.find('[data-testid="submit"]').exists()).toBe(true));
		await page.find('[data-testid="submit"]').trigger('click');
		await vi.waitFor(() => expect(executed).toHaveBeenCalledWith({ targetMonth: '2026-09' }));
		await vi.waitFor(() => expect(page.find('[data-testid="done"]').exists()).toBe(true));
		expect(page.find('[data-testid="done"]').text()).toContain('3 行を書きました');
	});

	// 3.9。中止条件は1行も書かずに止まる。理由を出す
	it.each([
		[
			'様式が変わった',
			502,
			'SHEET_FORMAT_CHANGED',
			'提出シートの様式が変わっています',
			'手で入力してください',
		],
		[
			'共有が締められた',
			502,
			'SHEET_UNREACHABLE',
			'提出シートに届きませんでした',
			'提出シートに届きませんでした',
		],
	])('確認で%sなら中止として理由を出す', async (_label, status, code, message, phrase) => {
		previewFails = { status, code, message };
		const page = await openPage();
		await vi.waitFor(() => expect(page.find('[data-testid="aborted"]').exists()).toBe(true));
		expect(page.text()).toContain('何も書いていません');
		expect(page.text()).toContain(phrase);
		expect(page.find('[data-testid="submit"]').exists()).toBe(false);
	});

	// 6.2。確認と実行のあいだに月度が変わったら 409 で止まり、確認からやり直す
	it('実行で月度が変わっていれば中止し、やり直しを促す', async () => {
		executeFails = {
			status: 409,
			code: 'TARGET_MONTH_CHANGED',
			message: '提出シートの対象月度が変わりました。確認し直してください',
		};
		const page = await openPage();
		await vi.waitFor(() => expect(page.find('[data-testid="submit"]').exists()).toBe(true));
		await page.find('[data-testid="submit"]').trigger('click');
		await vi.waitFor(() => expect(page.find('[data-testid="aborted"]').exists()).toBe(true));
		expect(page.text()).toContain('もう一度確認からやり直してください');
	});
});

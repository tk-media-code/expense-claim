import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { readBody, setResponseStatus } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import type { ExpenseRecordView } from '~/types/expense-record';
import type { Route, RouteLeg } from '~/types/route';
import RecordPage from './record.vue';

// 要件定義 5.6 の架空の例。AAA は乙駅乗換1本、BBB は丁駅乗換と戊駅直通の2本
function leg(sortOrder: number, from: string, to: string, fare: number): RouteLeg {
	return {
		sortOrder,
		segmentId: sortOrder,
		fromStationName: from,
		toStationName: to,
		oneWayFare: fare,
	};
}
const viaOtsu: Route = {
	id: 1,
	venueId: 1,
	name: '乙駅乗換',
	legs: [leg(1, 'X鉄甲駅', 'X鉄乙駅', 320), leg(2, 'Y鉄乙駅', 'Y鉄丙駅', 210)],
};
const viaTei: Route = {
	id: 2,
	venueId: 2,
	name: '丁駅乗換',
	legs: [leg(1, 'X鉄甲駅', 'X鉄丁駅', 380), leg(2, 'Y鉄丁駅', 'Y鉄戊駅', 210)],
};
const direct: Route = {
	id: 3,
	venueId: 2,
	name: '戊駅直通',
	legs: [leg(1, 'X鉄甲駅', 'Z鉄戊駅', 520)],
};

const project = {
	id: 3,
	serviceDate: '2026-09-05',
	venueCode: 'AAA',
	venueName: '甲ホール',
	coupleName: '〇〇様△△様',
};

const oneRoute: ExpenseRecordView = {
	project,
	routes: [viaOtsu],
	defaults: {
		tripType: 'round',
		outboundRouteId: 1,
		returnRouteId: 1,
		legs: [
			{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
			{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
		],
	},
	record: null,
	taxiRides: [],
};
const twoRoutes: ExpenseRecordView = {
	project: { ...project, id: 4, venueCode: 'BBB', venueName: '乙迎賓館' },
	routes: [viaTei, direct],
	defaults: { tripType: 'round', outboundRouteId: null, returnRouteId: null, legs: [] },
	record: null,
	taxiRides: [],
};
const noRoutes: ExpenseRecordView = {
	project: { ...project, id: 5, venueCode: 'EEE', venueName: '戊スタジオ' },
	routes: [],
	defaults: { tripType: 'round', outboundRouteId: null, returnRouteId: null, legs: [] },
	record: null,
	taxiRides: [],
};

let view: ExpenseRecordView;
const put = vi.fn<(body: Record<string, unknown>) => void>();
const taxiPosted = vi.fn<(fields: Record<string, string>) => void>();
const taxiRemoved = vi.fn<(id: number) => void>();
let taxiFails = false;

// テスト環境の $fetch は multipart を組み立てられない（content-type が付かず h3 が読めない）ので、
// タクシーの POST だけ useApi を差し替えて、送ろうとした FormData の中身を直接見る。他の呼び出しは実物へ通す
mockNuxtImport('useApi', () => {
	return () => {
		const real = useNuxtApp().$api;
		return ((url: string, options?: { method?: string; body?: unknown }) => {
			if (url === '/projects/3/taxi-rides' && options?.body instanceof FormData) {
				const fields: Record<string, string> = {};
				for (const [name, value] of options.body.entries()) {
					fields[name] = value instanceof File ? `file:${value.name}:${value.type}` : String(value);
				}
				taxiPosted(fields);
				if (taxiFails) {
					return Promise.reject(new Error('DRIVE_UPLOAD_FAILED'));
				}
				const created = {
					id: 7,
					rodeOn: '2026-09-05',
					amount: Number(fields.amount),
					receipt: {
						fileName: '20260905_AAA_1.jpg',
						driveUrl: 'https://drive.google.com/file/d/x/view',
					},
				};
				view = { ...view, taxiRides: [...view.taxiRides, created] };
				return Promise.resolve(created);
			}
			return real(url, options as never);
		}) as typeof real;
	};
});

registerEndpoint('/api/taxi-rides/7', {
	method: 'DELETE',
	handler: (event) => {
		taxiRemoved(7);
		view = { ...view, taxiRides: view.taxiRides.filter((r) => r.id !== 7) };
		setResponseStatus(event, 204);
		return null;
	},
});

for (const id of [3, 4, 5]) {
	registerEndpoint(`/api/projects/${id}/expense-record`, { method: 'GET', handler: () => view });
	registerEndpoint(`/api/projects/${id}/expense-record`, {
		method: 'PUT',
		handler: async (event) => {
			const body = await readBody<Record<string, unknown>>(event);
			put(body);
			return {
				id: 12,
				tripType: body.tripType,
				outboundRouteId: body.outboundRouteId,
				returnRouteId: body.returnRouteId ?? body.outboundRouteId,
				recordedAt: '2026-09-05T10:03:00Z',
				legs: view.defaults.legs,
			};
		},
	});
}

let wrapper: VueWrapper | null = null;

function legTexts(page: VueWrapper) {
	return page.findAll('[data-testid="legs"] li').map((li) => li.text());
}

// Reka UI のラジオは button[role="radio"] で描画される
async function choose(page: VueWrapper, testId: string, value: string) {
	const radio = page.find(`[data-testid="${testId}"] button[role="radio"][value="${value}"]`);
	await radio.trigger('click');
	await nextTick();
}

beforeEach(() => {
	view = oneRoute;
	taxiFails = false;
	vi.clearAllMocks();
});

async function chooseFile(page: VueWrapper, file: File) {
	const input = page.find<HTMLInputElement>('[data-testid="taxi-receipt"]');
	Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
	await input.trigger('change');
}

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('/projects/:id/record（02-screens.md 3.5）', () => {
	// 2.2 の2手目。開いた時点で保存できる状態になっている
	it('ルートが1本なら選択済みで開き、区間と合計が出て、そのまま保存できる', async () => {
		wrapper = await mountSuspended(RecordPage, { route: '/projects/3/record' });
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(2));

		expect(wrapper.find('[data-testid="summary"]').text()).toContain('9/5（土）');
		expect(wrapper.find('[data-testid="summary"]').text()).toContain('甲ホール');
		expect(legTexts(wrapper)[0]).toContain('X鉄甲駅 → X鉄乙駅');
		expect(legTexts(wrapper)[0]).toContain('640円');
		expect(wrapper.find('[data-testid="total"]').text()).toBe('1,060円');
		// 区間の並びに運賃の入力欄は無い（F-20）
		expect(wrapper.find('[data-testid="legs"]').findAll('input')).toHaveLength(0);
		// 往復なので復路は出ない
		expect(wrapper.find('[data-testid="return"]').exists()).toBe(false);

		await wrapper.find('[data-testid="save"]').trigger('click');
		await vi.waitFor(() =>
			expect(put).toHaveBeenCalledWith({ tripType: 'round', outboundRouteId: 1 }),
		);
	});

	// 4.3。2本以上なら未選択で、選ぶ1手が加わる（決定21。前回のルートを既定にしない）
	it('ルートが2本なら未選択で開き、選ぶまで保存できない', async () => {
		view = twoRoutes;
		wrapper = await mountSuspended(RecordPage, { route: '/projects/4/record' });
		await vi.waitFor(() => expect(wrapper!.find('[data-testid="outbound"]').exists()).toBe(true));

		expect(wrapper.find('[data-testid="save"]').attributes('disabled')).toBeDefined();
		expect(legTexts(wrapper)).toHaveLength(0);

		await choose(wrapper, 'outbound', '2');
		expect(legTexts(wrapper)).toHaveLength(2);
		expect(legTexts(wrapper)[0]).toContain('760円');
		expect(wrapper.find('[data-testid="save"]').attributes('disabled')).toBeUndefined();
	});

	// 決定3 / 要件定義 5.6 の案件 B。片道を選ぶと復路が出て、反転した区間が続く
	it('片道を選ぶと復路ルートが出て、復路を反転した区間が続く', async () => {
		view = twoRoutes;
		wrapper = await mountSuspended(RecordPage, { route: '/projects/4/record' });
		await vi.waitFor(() => expect(wrapper!.find('[data-testid="outbound"]').exists()).toBe(true));

		await choose(wrapper, 'outbound', '2');
		await wrapper.find('button[role="radio"][value="one_way"]').trigger('click');
		await nextTick();
		expect(wrapper.find('[data-testid="return"]').exists()).toBe(true);
		await choose(wrapper, 'return', '3');

		const rows = legTexts(wrapper);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toContain('X鉄甲駅 → X鉄丁駅');
		expect(rows[0]).toContain('380円');
		expect(rows[2]).toContain('Z鉄戊駅 → X鉄甲駅');
		expect(wrapper.find('[data-testid="total"]').text()).toBe('1,110円');

		await wrapper.find('[data-testid="save"]').trigger('click');
		await vi.waitFor(() =>
			expect(put).toHaveBeenCalledWith({
				tripType: 'one_way',
				outboundRouteId: 2,
				returnRouteId: 3,
			}),
		);
	});

	// 4.3。0本のときに黙って空の画面を出さない
	it('ルートが0本なら記録できない旨を出し、会場とルートへ導く', async () => {
		view = noRoutes;
		wrapper = await mountSuspended(RecordPage, { route: '/projects/5/record' });
		await vi.waitFor(() => expect(wrapper!.find('[data-testid="no-routes"]').exists()).toBe(true));
		expect(wrapper.text()).toContain('ルートが登録されていません');
		expect(wrapper.find('a[href="/venues"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="save"]').exists()).toBe(false);
	});

	// 04-api.md 5.2。record が null でないときは、そちらが defaults に優先する
	it('記録済みの案件を開き直すと、記録した内容が入っている', async () => {
		view = {
			...twoRoutes,
			record: {
				id: 12,
				tripType: 'one_way',
				outboundRouteId: 2,
				returnRouteId: 3,
				recordedAt: '2026-09-05T10:03:00Z',
				legs: [],
			},
		};
		wrapper = await mountSuspended(RecordPage, { route: '/projects/4/record?from=detail' });
		await vi.waitFor(() => expect(wrapper!.find('[data-testid="return"]').exists()).toBe(true));
		expect(legTexts(wrapper)).toHaveLength(3);
	});

	// 3.5。既定では畳んでおく。タクシーに乗った日は +2手（金額とアップロード）
	it('タクシーは畳まれており、開いて金額を入れ領収書を選ぶと、その場で POST が飛ぶ', async () => {
		wrapper = await mountSuspended(RecordPage, { route: '/projects/3/record' });
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(2));
		expect(wrapper.find('[data-testid="taxi-body"]').exists()).toBe(false);

		await wrapper.find('[data-testid="taxi-toggle"]').trigger('click');
		await nextTick();
		await wrapper.find('[data-testid="taxi-amount"]').setValue('1800');
		await chooseFile(
			wrapper,
			new File([new Uint8Array([1, 2, 3])], 'IMG_1234.jpg', { type: 'image/jpeg' }),
		);
		await vi.waitFor(() =>
			expect(taxiPosted).toHaveBeenCalledWith({
				amount: '1800',
				receipt: 'file:IMG_1234.jpg:image/jpeg',
			}),
		);
		await vi.waitFor(() => expect(wrapper!.findAll('[data-testid="taxi-ride"]')).toHaveLength(1));
		expect(wrapper.find('[data-testid="taxi-ride"]').text()).toContain('1,800円');
		expect(wrapper.find('[data-testid="taxi-ride"] a').attributes('href')).toContain(
			'drive.google.com',
		);
	});

	it('金額より先に領収書を選ぶと持っておき、「追加する」で送る', async () => {
		wrapper = await mountSuspended(RecordPage, { route: '/projects/3/record' });
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(2));
		await wrapper.find('[data-testid="taxi-toggle"]').trigger('click');
		await nextTick();
		await chooseFile(wrapper, new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }));
		await nextTick();
		expect(taxiPosted).not.toHaveBeenCalled();
		await wrapper.find('[data-testid="taxi-amount"]').setValue('1400');
		await wrapper.find('[data-testid="taxi-submit"]').trigger('click');
		await vi.waitFor(() =>
			expect(taxiPosted).toHaveBeenCalledWith({
				amount: '1400',
				receipt: 'file:receipt.pdf:application/pdf',
			}),
		);
	});

	// F-26。保存に失敗したら乗車は記録されない。金額は残す
	it('保存に失敗しても乗車は増えず、金額は残る', async () => {
		taxiFails = true;
		wrapper = await mountSuspended(RecordPage, { route: '/projects/3/record' });
		await vi.waitFor(() => expect(legTexts(wrapper!)).toHaveLength(2));
		await wrapper.find('[data-testid="taxi-toggle"]').trigger('click');
		await nextTick();
		await wrapper.find('[data-testid="taxi-amount"]').setValue('1800');
		await chooseFile(wrapper, new File([new Uint8Array([1])], 'IMG.jpg', { type: 'image/jpeg' }));
		await vi.waitFor(() => expect(taxiPosted).toHaveBeenCalled());
		await nextTick();
		expect(wrapper.findAll('[data-testid="taxi-ride"]')).toHaveLength(0);
		expect(wrapper.find<HTMLInputElement>('[data-testid="taxi-amount"]').element.value).toBe(
			'1800',
		);
	});

	it('記録済みの乗車は開いた状態で並び、消せる', async () => {
		view = {
			...oneRoute,
			taxiRides: [
				{
					id: 7,
					rodeOn: '2026-09-05',
					amount: 1800,
					receipt: {
						fileName: '20260905_AAA_1.jpg',
						driveUrl: 'https://drive.google.com/file/d/x/view',
					},
				},
			],
		};
		wrapper = await mountSuspended(RecordPage, { route: '/projects/3/record' });
		await vi.waitFor(() => expect(wrapper!.findAll('[data-testid="taxi-ride"]')).toHaveLength(1));
		expect(wrapper.find('[data-testid="taxi-toggle"]').text()).toContain('1回・1,800円');
		await wrapper.find('[data-testid="taxi-ride"] button').trigger('click');
		await vi.waitFor(() => expect(taxiRemoved).toHaveBeenCalledWith(7));
		await vi.waitFor(() => expect(wrapper!.findAll('[data-testid="taxi-ride"]')).toHaveLength(0));
	});
});

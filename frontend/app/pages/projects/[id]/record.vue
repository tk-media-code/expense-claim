<script setup lang="ts">
import type { RadioGroupItem } from '@nuxt/ui';

import {
	previewLegs,
	type ExpenseRecord,
	type ExpenseRecordView,
	type TripType,
} from '~/types/expense-record';

definePageMeta({
	title: '交通費の記録',
	back: (route) => (route.query.from === 'detail' ? `/projects/${route.params.id}` : '/'),
});

const api = useApi();
const route = useRoute();
const router = useRouter();
const id = String(route.params.id);

// 集約の1本（04-api.md 3.1）。開いた時点で保存できる状態になっている（02-screens.md 3.5）
const { data, status, error, refresh } = await useApiFetch<ExpenseRecordView>(
	`/projects/${id}/expense-record`,
);
const view = computed(() => data.value ?? null);

const tripType = ref<TripType>('round');
const outboundRouteId = ref<number | null>(null);
const returnRouteId = ref<number | null>(null);
// 保存した直後は、サーバーが返した区間をそのまま出す（5.3）。ずれていれば画面で分かる
const saved = ref<ExpenseRecord | null>(null);

// record が null でないときは、そちらが defaults に優先する（04-api.md 5.2）
watch(
	view,
	(v) => {
		if (!v) return;
		const source = v.record ?? v.defaults;
		tripType.value = source.tripType;
		outboundRouteId.value = source.outboundRouteId;
		returnRouteId.value = source.returnRouteId;
	},
	{ immediate: true },
);

// 往復に戻したら復路は往路と同じになる（決定9）
watch(tripType, (t) => {
	if (t === 'round') returnRouteId.value = outboundRouteId.value;
});
watch(outboundRouteId, (o) => {
	if (tripType.value === 'round') returnRouteId.value = o;
	saved.value = null;
});
watch(returnRouteId, () => {
	saved.value = null;
});

const routes = computed(() => view.value?.routes ?? []);
const routeItems = computed<RadioGroupItem[]>(() =>
	routes.value.map((r) => ({
		label: r.name,
		description: `${r.legs.map((l) => `${l.fromStationName}→${l.toStationName}`).join(' / ')} · 片道 ${r.legs.reduce((s, l) => s + l.oneWayFare, 0).toLocaleString()}円`,
		value: r.id,
	})),
);
const tripItems: RadioGroupItem[] = [
	{ label: '往復', value: 'round', description: '往路と復路が同じルート' },
	{ label: '片道', value: 'one_way', description: '往路と復路で違うルート' },
];

const outbound = computed(() => routes.value.find((r) => r.id === outboundRouteId.value) ?? null);
const inbound = computed(() =>
	tripType.value === 'round'
		? outbound.value
		: (routes.value.find((r) => r.id === returnRouteId.value) ?? null),
);

// 表示のための計算はクライアントも持つ（04-api.md 3.2）。保存後はサーバーの値が優先
const legs = computed(() => {
	if (saved.value) return saved.value.legs;
	if (!outbound.value || !inbound.value) return [];
	return previewLegs(tripType.value, outbound.value.legs, inbound.value.legs);
});
const total = computed(() => legs.value.reduce((sum, leg) => sum + leg.amount, 0));
const canSave = computed(() => outbound.value !== null && inbound.value !== null);

const saving = ref(false);

async function save() {
	saving.value = true;
	try {
		// 区間も駅名も金額も送らない。送るのは選んだルートだけ（04-api.md 5.3）
		saved.value = await api<ExpenseRecord>(`/projects/${id}/expense-record`, {
			method: 'PUT',
			body: {
				tripType: tripType.value,
				outboundRouteId: outboundRouteId.value,
				returnRouteId: tripType.value === 'one_way' ? returnRouteId.value : undefined,
			},
		});
		// 戻り先は、この画面を開いた画面（3.5）。保存したあとも同じところへ帰る
		await router.push(backOf(route) ?? '/');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している。選んだ内容は残す
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<div class="space-y-6">
		<div v-if="status === 'pending'" class="space-y-2">
			<USkeleton v-for="n in 4" :key="n" class="h-10 w-full" />
		</div>

		<div v-else-if="error || !view" class="space-y-3">
			<p class="text-muted text-sm">記録画面を読み込めませんでした。</p>
			<UButton variant="outline" @click="refresh()">もう一度読み込む</UButton>
		</div>

		<template v-else>
			<!-- 案件の要約（2.3）。押した後にも先頭で、取り違えていないか確かめられる -->
			<div data-testid="summary">
				<p class="font-semibold">
					{{ formatServiceDate(view.project.serviceDate) }} · {{ view.project.venueName }}
				</p>
				<p class="text-muted text-sm">{{ view.project.coupleName }}</p>
			</div>

			<!-- 0本のときに黙って空の画面を出さない（4.3）。会場とルートへ導く -->
			<UAlert
				v-if="routes.length === 0"
				color="warning"
				variant="subtle"
				icon="i-lucide-map-pin-off"
				title="ルートが登録されていません"
				:description="`${venueLabel({ code: view.project.venueCode, name: view.project.venueName })} にルートが無いので、交通費を記録できない。先に会場とルートで登録する。`"
				:actions="[
					{ label: '会場とルートを開く', to: '/venues', color: 'warning', variant: 'solid' },
				]"
				data-testid="no-routes"
			/>

			<template v-else>
				<UFormField label="往復 / 片道">
					<URadioGroup
						v-model="tripType"
						:items="tripItems"
						orientation="horizontal"
						variant="card"
					/>
				</UFormField>

				<UFormField
					label="往路ルート"
					:description="routes.length === 1 ? '' : 'ルートが複数あるので、どちらで行ったかを選ぶ'"
				>
					<URadioGroup
						v-model="outboundRouteId"
						:items="routeItems"
						variant="card"
						data-testid="outbound"
					/>
				</UFormField>

				<!-- 復路は片道のときだけ出す。往復なら自動的に決まる（3.5） -->
				<UFormField v-if="tripType === 'one_way'" label="復路ルート">
					<URadioGroup
						v-model="returnRouteId"
						:items="routeItems"
						variant="card"
						data-testid="return"
					/>
				</UFormField>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h2 class="font-semibold">区間</h2>
						<span class="font-semibold tabular-nums" data-testid="total"
							>{{ total.toLocaleString() }}円</span
						>
					</div>
					<p v-if="legs.length === 0" class="text-muted text-sm">
						ルートを選ぶと区間と金額が出る。
					</p>
					<ol v-else class="divide-default divide-y" data-testid="legs">
						<li v-for="leg in legs" :key="leg.sortOrder" class="flex items-center gap-2 py-2">
							<span class="text-muted w-5 shrink-0 text-sm tabular-nums">{{ leg.sortOrder }}</span>
							<span class="min-w-0 flex-1 truncate"
								>{{ leg.fromStationName }} → {{ leg.toStationName }}</span
							>
							<!-- 金額の入力欄を置かない（F-20）。直す場所は「区間と運賃」だけ -->
							<span class="shrink-0 tabular-nums">{{ leg.amount.toLocaleString() }}円</span>
						</li>
					</ol>
				</div>

				<!-- タクシーと領収書。乗車は交通費記録と独立していて、選んだ時点で送る（04-api.md 4.6） -->
				<TaxiRides
					:project-id="view.project.id"
					:taxi-rides="view.taxiRides"
					@changed="refresh()"
				/>

				<!-- 2手目 -->
				<UButton
					:loading="saving"
					:disabled="!canSave"
					size="lg"
					block
					data-testid="save"
					@click="save"
				>
					保存
				</UButton>
			</template>
		</template>
	</div>
</template>

<script setup lang="ts">
import type { Route } from '~/types/route';
import type { Segment } from '~/types/segment';
import type { Station } from '~/types/station';
import type { Venue } from '~/types/venue';

// 「ルートの編集」の本体（02-screens.md 3.7）。/routes/new と /routes/:id が共に使う。
//
// 区間は登録済みのものから並べる。足りない区間はその場で登録でき、登録したものはそのまま並びに入る。
// この画面では並べた区間の運賃を直せない。片道運賃は区間が持ち（決定18）、直すと使っている全ルートに効く。
// 波及するものを、1本のルートを編集している最中に触らせない。直す場所は「区間と運賃」だけである。
const props = defineProps<{
	/** 編集なら既存のルート。新規なら null */
	route: Route | null;
	/** 新規のときの会場の既定値（会場とルートの画面から来たとき） */
	defaultVenueId?: number;
}>();

const api = useApi();
const router = useRouter();

// 開いたときに叩く（04-api.md 8章）。区間を選ばせるための一覧と、会場を選ばせるための一覧
const segmentsFetch = await useApiFetch<{ segments: Segment[] }>('/segments');
const venuesFetch = await useApiFetch<{ venues: Venue[] }>('/venues');
const stationsFetch = await useApiFetch<{ stations: Station[] }>('/stations');
const segments = computed(() => segmentsFetch.data.value?.segments ?? []);
const stations = computed(() => stationsFetch.data.value?.stations ?? []);
const venueItems = computed(() =>
	(venuesFetch.data.value?.venues ?? []).map((venue) => ({
		id: venue.id,
		label: venueLabel(venue),
	})),
);

const name = ref(props.route?.name ?? '');
const venueId = ref<number | undefined>(props.route?.venueId ?? props.defaultVenueId);
// 並び。同じ区間が2回入りうるので、区間の id ではなく並びの位置で扱う
const legs = ref<Segment[]>(
	(props.route?.legs ?? []).map((leg) => ({
		id: leg.segmentId,
		fromStationId: 0,
		fromStationName: leg.fromStationName,
		toStationId: 0,
		toStationName: leg.toStationName,
		oneWayFare: leg.oneWayFare,
		routeCount: 0,
	})),
);

// 合計の表示はクライアントが決めてよい（04-api.md 3.2）。書き込むのは区間ごとの額であって合計ではない
const oneWayTotal = computed(() => legs.value.reduce((sum, leg) => sum + leg.oneWayFare, 0));

const pickOpen = ref(false);
const addOpen = ref(false);
const saving = ref(false);

function add(segment: Segment) {
	legs.value = [...legs.value, segment];
}

// 登録したばかりの区間はそのまま並びに入れる（3.7）。登録だけして並びに入れないと、
// 閉じたあとに「区間を足す」で選び直す手が要る
function onCreated(segment: Segment) {
	add(segment);
	void segmentsFetch.refresh();
	void stationsFetch.refresh();
}

function removeAt(index: number) {
	legs.value = legs.value.filter((_, i) => i !== index);
}

// 並べ替えは上下ボタン（決定20）。ドラッグは縦スクロールと取り合いになる
function move(index: number, delta: -1 | 1) {
	const target = index + delta;
	if (target < 0 || target >= legs.value.length) return;
	const next = [...legs.value];
	const [moved] = next.splice(index, 1);
	if (!moved) return;
	next.splice(target, 0, moved);
	legs.value = next;
}

async function save() {
	saving.value = true;
	try {
		// segmentIds の配列順がそのまま並び順。sort_order はサーバーが振る（04-api.md 3.2）
		const body = {
			venueId: venueId.value,
			name: name.value,
			segmentIds: legs.value.map((leg) => leg.id),
		};
		if (props.route) {
			await api<Route>(`/routes/${props.route.id}`, { method: 'PUT', body });
		} else {
			await api<Route>('/routes', { method: 'POST', body });
		}
		// この画面の仕事が終わったので、固定の親へ戻る（2.1）
		await router.push('/venues');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している。打った内容は残す
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<form class="space-y-6" @submit.prevent="save">
		<UFormField label="ルート名">
			<UInput v-model="name" class="w-full" placeholder="乙駅乗換" />
		</UFormField>

		<UFormField label="紐づく会場">
			<USelectMenu
				v-model="venueId"
				:items="venueItems"
				value-key="id"
				label-key="label"
				placeholder="会場を選ぶ"
				:search-input="{ placeholder: '会場コード・会場名で探す' }"
				class="w-full"
				aria-label="紐づく会場"
			/>
		</UFormField>

		<div class="space-y-3">
			<div class="flex items-center justify-between gap-2">
				<h2 class="font-semibold">区間の並び（自宅→会場）</h2>
				<span class="text-muted text-sm">片道 {{ oneWayTotal.toLocaleString() }}円</span>
			</div>

			<p v-if="legs.length === 0" class="text-muted text-sm">まだ区間を並べていない。</p>
			<ol v-else class="divide-default divide-y" data-testid="legs">
				<li v-for="(leg, index) in legs" :key="index" class="flex items-center gap-2 py-2">
					<span class="text-muted w-5 shrink-0 text-sm tabular-nums">{{ index + 1 }}</span>
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="truncate">{{ leg.fromStationName }} → {{ leg.toStationName }}</span>
						<!-- 運賃は表示だけ。直す場所は「区間と運賃」（3.8） -->
						<span class="text-muted text-sm tabular-nums"
							>{{ leg.oneWayFare.toLocaleString() }}円</span
						>
					</span>
					<UButton
						icon="i-lucide-chevron-up"
						variant="ghost"
						color="neutral"
						size="sm"
						:disabled="index === 0"
						:aria-label="`${index + 1}番目を上へ`"
						@click="move(index, -1)"
					/>
					<UButton
						icon="i-lucide-chevron-down"
						variant="ghost"
						color="neutral"
						size="sm"
						:disabled="index === legs.length - 1"
						:aria-label="`${index + 1}番目を下へ`"
						@click="move(index, 1)"
					/>
					<UButton
						icon="i-lucide-x"
						variant="ghost"
						color="neutral"
						size="sm"
						:aria-label="`${index + 1}番目を外す`"
						@click="removeAt(index)"
					/>
				</li>
			</ol>

			<!-- どちらの操作もこの画面を離れない（3.7）。シートを重ねて出す -->
			<div class="flex flex-wrap gap-2">
				<UButton icon="i-lucide-plus" variant="outline" @click="pickOpen = true"
					>区間を足す</UButton
				>
				<UButton icon="i-lucide-plus" variant="outline" color="neutral" @click="addOpen = true">
					区間を登録する
				</UButton>
			</div>
		</div>

		<UButton type="submit" :loading="saving" block>{{
			route ? 'この内容で直す' : '登録する'
		}}</UButton>

		<SegmentPickSheet v-model:open="pickOpen" :segments="segments" @pick="add" />
		<SegmentAddSheet
			v-model:open="addOpen"
			:stations="stations"
			@changed="onCreated"
			@stations-changed="stationsFetch.refresh()"
		/>
	</form>
</template>

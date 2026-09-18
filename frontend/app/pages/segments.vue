<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';

import type { Segment } from '~/types/segment';
import type { Station } from '~/types/station';

definePageMeta({
	title: '区間と運賃',
	back: '/',
});

// 開いたときに叩く2本（04-api.md 8章）。両方の一覧をこの画面が持ち、シートへ渡す
const stationsFetch = await useApiFetch<{ stations: Station[] }>('/stations');
const segmentsFetch = await useApiFetch<{ segments: Segment[] }>('/segments');

// 並びはサーバーが決めている（駅は名前順、区間は出発駅名→到着駅名）。画面では並べ替えない
const stations = computed(() => stationsFetch.data.value?.stations ?? []);
const segments = computed(() => segmentsFetch.data.value?.segments ?? []);

// 既定は `区間`。運賃改定はこの画面だけで終わる（R-23）ので、直す先を先に出す
const tab = ref('segment');

// タブに件数を添える（3.8）
const tabs = computed<TabsItem[]>(() => [
	{ label: '区間', value: 'segment', badge: segments.value.length },
	{ label: '駅', value: 'station', badge: stations.value.length },
]);

const segmentAddOpen = ref(false);
const segmentEditOpen = ref(false);
const editingSegment = ref<Segment | null>(null);
const stationAddOpen = ref(false);
const stationEditOpen = ref(false);
const editingStation = ref<Station | null>(null);

function openSegment(segment: Segment) {
	editingSegment.value = segment;
	segmentEditOpen.value = true;
}

function openStation(station: Station) {
	editingStation.value = station;
	stationEditOpen.value = true;
}

// segmentCount / routeCount はサーバーが数える。手元で足し引きしない
function reloadStations() {
	void stationsFetch.refresh();
}

// 区間を直せば駅の segmentCount も動くので、両方取り直す
function reloadSegments() {
	void segmentsFetch.refresh();
	void stationsFetch.refresh();
}
</script>

<template>
	<div>
		<!--
			タブは見出しに固定し、どこまでスクロールしても1手で行き来できるようにする（3.8）。
			アプリバーは sticky ではないので、ページ側で画面上端に貼る。
			負のマージンは <main> の余白を相殺するためで、貼り付いたときに隙間から中身が覗かない。
		-->
		<div class="bg-default sticky top-0 z-10 -mx-4 -mt-6 px-4 pt-6 pb-3">
			<UTabs v-model="tab" :items="tabs" :content="false" class="w-full" />
		</div>

		<div v-if="tab === 'segment'" class="space-y-4" data-testid="segment-tab">
			<!-- 追加の操作は一覧の見出しの右端に置く。一覧と一覧の間だと、どちらに効くか位置で決まらない（3.8） -->
			<div class="flex items-center justify-between gap-2">
				<h2 class="font-semibold">登録済みの区間</h2>
				<UButton icon="i-lucide-plus" @click="segmentAddOpen = true">区間を追加</UButton>
			</div>

			<div v-if="segmentsFetch.status.value === 'pending'" class="space-y-2">
				<USkeleton v-for="n in 3" :key="n" class="h-14 w-full" />
			</div>

			<!-- 読み込めなかったことを「まだ区間がありません」と出さない。空と失敗は別のことである -->
			<div v-else-if="segmentsFetch.error.value" class="space-y-3">
				<p class="text-muted text-sm">区間の一覧を読み込めませんでした。</p>
				<UButton variant="outline" @click="reloadSegments">もう一度読み込む</UButton>
			</div>

			<p v-else-if="segments.length === 0" class="text-muted text-sm">まだ区間がありません。</p>

			<ul v-else class="divide-default divide-y">
				<li v-for="segment in segments" :key="segment.id">
					<button
						type="button"
						class="hover:bg-elevated flex w-full items-center gap-3 rounded-sm px-1 py-3 text-left"
						@click="openSegment(segment)"
					>
						<span class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span class="min-w-0 truncate font-medium">
								{{ segment.fromStationName }} → {{ segment.toStationName }}
							</span>
							<span class="text-muted text-sm">
								{{
									segment.routeCount > 0
										? `${segment.routeCount}本のルートが使っています`
										: 'まだどのルートも使っていません'
								}}
							</span>
						</span>
						<span class="shrink-0 tabular-nums">{{ segment.oneWayFare.toLocaleString() }}円</span>
					</button>
				</li>
			</ul>
		</div>

		<div v-else class="space-y-4" data-testid="station-tab">
			<!-- 追加の操作は一覧の見出しの右端に置く。一覧と一覧の間だと、どちらに効くか位置で決まらない（3.8） -->
			<div class="flex items-center justify-between gap-2">
				<h2 class="font-semibold">登録済みの駅</h2>
				<UButton icon="i-lucide-plus" @click="stationAddOpen = true">駅を登録</UButton>
			</div>

			<div v-if="stationsFetch.status.value === 'pending'" class="space-y-2">
				<USkeleton v-for="n in 3" :key="n" class="h-14 w-full" />
			</div>

			<!-- 読み込めなかったことを「まだ駅がありません」と出さない。空と失敗は別のことである -->
			<div v-else-if="stationsFetch.error.value" class="space-y-3">
				<p class="text-muted text-sm">駅の一覧を読み込めませんでした。</p>
				<UButton variant="outline" @click="reloadStations">もう一度読み込む</UButton>
			</div>

			<p v-else-if="stations.length === 0" class="text-muted text-sm">まだ駅がありません。</p>

			<ul v-else class="divide-default divide-y">
				<li v-for="station in stations" :key="station.id">
					<button
						type="button"
						class="hover:bg-elevated flex w-full flex-col items-start gap-0.5 rounded-sm px-1 py-3 text-left"
						@click="openStation(station)"
					>
						<span class="min-w-0 truncate font-medium">{{ station.name }}</span>
						<span class="text-muted text-sm">
							{{
								station.segmentCount > 0
									? `${station.segmentCount}区間が使っています`
									: 'まだどの区間も使っていません'
							}}
						</span>
					</button>
				</li>
			</ul>
		</div>

		<SegmentAddSheet
			v-model:open="segmentAddOpen"
			:stations="stations"
			@changed="reloadSegments"
			@stations-changed="reloadStations"
		/>
		<SegmentEditSheet
			v-model:open="segmentEditOpen"
			:segment="editingSegment"
			:stations="stations"
			@changed="reloadSegments"
			@stations-changed="reloadStations"
		/>
		<StationAddSheet v-model:open="stationAddOpen" @changed="reloadStations" />
		<StationEditSheet
			v-model:open="stationEditOpen"
			:station="editingStation"
			@changed="reloadSegments"
		/>
	</div>
</template>

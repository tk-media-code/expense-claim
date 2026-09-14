<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';

import type { Station } from '~/types/station';

definePageMeta({
	title: '区間と運賃',
	back: '/',
});

const { data, status, error, refresh } = await useApiFetch<{ stations: Station[] }>('/stations');

// 並びはサーバーが決めている（名前順）。画面では並べ替えない（04-api.md 5.1 の流儀）
const stations = computed(() => data.value?.stations ?? []);

// 既定は `駅`。1-5 の時点で中身があるのはこちらだけで、`区間` は 1-8 で入る。
const tab = ref('station');

// 区間タブに件数を付けない。GET /api/segments は 1-6 で、数えられないものを 0 と書かない。
const tabs = computed<TabsItem[]>(() => [
	{ label: '区間', value: 'segment' },
	{ label: '駅', value: 'station', badge: stations.value.length },
]);

const addOpen = ref(false);
const editOpen = ref(false);
const editing = ref<Station | null>(null);

function openStation(station: Station) {
	editing.value = station;
	editOpen.value = true;
}

function reload() {
	// segmentCount はサーバーが数える。手元で足し引きしない
	void refresh();
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

		<ScreenPlaceholder v-if="tab === 'segment'" phase="1-8" spec="3.8" />

		<div v-else class="space-y-4">
			<p class="text-muted text-sm">
				<b>駅名は鉄道会社の略称込みで持つ</b
				>（F-15）。乗換駅は鉄道会社ごとに別の駅として書かれるので、 <code>X鉄乙駅</code> と
				<code>Y鉄乙駅</code> は<b>別の駅として登録する。</b>名寄せはしない。
			</p>

			<!-- 追加の操作は一覧の見出しの右端に置く。一覧と一覧の間だと、どちらに効くか位置で決まらない（3.8） -->
			<div class="flex items-center justify-between gap-2">
				<h2 class="font-semibold">登録済みの駅</h2>
				<UButton icon="i-lucide-plus" @click="addOpen = true">駅を登録</UButton>
			</div>

			<div v-if="status === 'pending'" class="space-y-2">
				<USkeleton v-for="n in 3" :key="n" class="h-14 w-full" />
			</div>

			<!-- 読み込めなかったことを「まだ駅がありません」と出さない。空と失敗は別のことである -->
			<div v-else-if="error" class="space-y-3">
				<p class="text-muted text-sm">駅の一覧を読み込めませんでした。</p>
				<UButton variant="outline" @click="reload">もう一度読み込む</UButton>
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

			<p class="text-muted text-sm">
				<b>駅は区間より先に登録する。</b>足す順は「駅 → 区間 → ルート」で固定である （<code
					>04-api.md</code
				>
				8章）。
			</p>
			<p class="text-muted text-sm">
				<b>駅をタップすると名前を直せる。</b>使われていても直せる。使われている駅は消せないので、
				<b>打ち間違いを直す手段がこれしかない。</b>
				<b>削除は、どの区間も使っていないときだけ</b>である（<code>03-database.md</code> 6.2 の
				RESTRICT）。
			</p>
		</div>

		<StationAddSheet v-model:open="addOpen" @changed="reload" />
		<StationEditSheet v-model:open="editOpen" :station="editing" @changed="reload" />
	</div>
</template>

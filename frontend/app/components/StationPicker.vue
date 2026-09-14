<script setup lang="ts">
import type { Station } from '~/types/station';

// 駅を選ぶ欄。選ぶだけでなく、その場で登録できる（02-screens.md 3.8）。
// 区間のシートの中から駅のシートを重ねて出し、閉じれば区間の入力へ戻る。打ちかけの運賃は残る。
// 駅が無いというだけで、区間の入力を捨てさせない。
const props = defineProps<{
	label: string;
	stations: Station[];
}>();
const value = defineModel<number | undefined>({ required: true });
// 駅を登録したら親に知らせ、駅一覧を取り直してもらう（駅タブの件数も変わる）
const emit = defineEmits<{ stationsChanged: [] }>();

const addOpen = ref(false);

// 登録したばかりの駅は、親の一覧が取り直されるまで選択肢に無い。
// その間も選択状態で見えるように、手元で選択肢に足しておく
const justCreated = ref<Station | null>(null);
const items = computed(() => {
	const created = justCreated.value;
	if (created && !props.stations.some((station) => station.id === created.id)) {
		return [...props.stations, created];
	}
	return props.stations;
});

function onCreated(station: Station) {
	justCreated.value = station;
	value.value = station.id;
	emit('stationsChanged');
}
</script>

<template>
	<UFormField :label="label">
		<div class="flex items-start gap-2">
			<USelectMenu
				v-model="value"
				:items="items"
				value-key="id"
				label-key="name"
				:placeholder="`${label}を選ぶ`"
				:search-input="{ placeholder: '駅名で探す' }"
				class="min-w-0 flex-1"
				:aria-label="label"
			/>
			<UButton
				icon="i-lucide-plus"
				variant="outline"
				color="neutral"
				:aria-label="`${label}を登録`"
				@click="addOpen = true"
			/>
		</div>
		<StationAddSheet v-model:open="addOpen" @changed="onCreated" />
	</UFormField>
</template>

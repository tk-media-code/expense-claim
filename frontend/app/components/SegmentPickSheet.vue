<script setup lang="ts">
import type { Segment } from '~/types/segment';

// 「区間を足す」のシート（02-screens.md 3.7）。登録済みの区間から選ぶ。
// 画面を替えずに重ねて出す（2.1）ので URL を持たない。
// 同じ区間を2回並べることは弾かない。設定データを機械が狭めにいかない（03-database.md 5.1）
defineProps<{ segments: Segment[] }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ pick: [segment: Segment] }>();

function pick(segment: Segment) {
	emit('pick', segment);
	open.value = false;
}
</script>

<template>
	<USlideover v-model:open="open" side="bottom" title="区間を足す">
		<template #body>
			<p v-if="segments.length === 0" class="text-muted text-sm">
				まだ区間がありません。「区間を登録する」で作る。
			</p>
			<ul v-else class="divide-default divide-y">
				<li v-for="segment in segments" :key="segment.id">
					<button
						type="button"
						class="hover:bg-elevated flex w-full items-center gap-3 rounded-sm px-1 py-3 text-left"
						@click="pick(segment)"
					>
						<span class="min-w-0 flex-1 truncate">
							{{ segment.fromStationName }} → {{ segment.toStationName }}
						</span>
						<span class="shrink-0 tabular-nums">{{ segment.oneWayFare.toLocaleString() }}円</span>
					</button>
				</li>
			</ul>
		</template>
	</USlideover>
</template>

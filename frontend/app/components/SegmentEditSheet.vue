<script setup lang="ts">
import type { Segment } from '~/types/segment';
import type { Station } from '~/types/station';

// 「この区間」のシート（02-screens.md 3.8）。
//
// 片道運賃は常に直せ、直すと使っている全ルートに効く（決定18）。
// 出発駅・到着駅の差し替えと削除は、どのルートも使っていないときだけ（決定22）。
// 変えられない・消せないときはボタンを黙って消さず、理由と「先に何をすれば」を出す（3.8）。
const props = defineProps<{ segment: Segment | null; stations: Station[] }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ changed: []; stationsChanged: [] }>();

const api = useApi();
const fromStationId = ref<number | undefined>(undefined);
const toStationId = ref<number | undefined>(undefined);
const oneWayFare = ref('');
const saving = ref(false);
const deleting = ref(false);

const inUse = computed(() => (props.segment?.routeCount ?? 0) > 0);

// 開いた区間の値を入力欄の初期値にする。失敗では閉じないので、開き直したときだけ入れ直す。
watch(
	() => (open.value ? props.segment : null),
	(segment) => {
		if (segment) {
			fromStationId.value = segment.fromStationId;
			toStationId.value = segment.toStationId;
			oneWayFare.value = String(segment.oneWayFare);
		}
	},
	{ immediate: true },
);

async function save() {
	if (!props.segment) return;
	saving.value = true;
	try {
		// 使用中なら駅を送らない。送れば 409（04-api.md 4.7）。欄も出していないので値は変わっていない
		const body = inUse.value
			? { oneWayFare: Number(toHalfWidthDigits(oneWayFare.value)) }
			: {
					fromStationId: fromStationId.value,
					toStationId: toStationId.value,
					oneWayFare: Number(toHalfWidthDigits(oneWayFare.value)),
				};
		await api<Segment>(`/segments/${props.segment.id}`, { method: 'PUT', body });
		open.value = false;
		emit('changed');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している。閉じないことだけをする。
	} finally {
		saving.value = false;
	}
}

async function remove() {
	if (!props.segment) return;
	deleting.value = true;
	try {
		await api(`/segments/${props.segment.id}`, { method: 'DELETE' });
		open.value = false;
		emit('changed');
	} catch {
		// 使用中なら 409 SEGMENT_IN_USE。ボタンを出していないので本来ここへは来ない（二重の網）。
	} finally {
		deleting.value = false;
	}
}
</script>

<template>
	<USlideover v-model:open="open" side="bottom" title="この区間">
		<template #body>
			<div v-if="segment" class="space-y-4">
				<form class="space-y-4" @submit.prevent="save">
					<template v-if="inUse">
						<dl class="space-y-1 text-sm">
							<div class="flex gap-2">
								<dt class="text-muted w-16 shrink-0">区間</dt>
								<dd>{{ segment.fromStationName }} → {{ segment.toStationName }}</dd>
							</div>
							<div class="flex gap-2">
								<dt class="text-muted w-16 shrink-0">使用中</dt>
								<dd>{{ segment.routeCount }}本のルート</dd>
							</div>
						</dl>
						<!-- 変えられないときこそ理由を出す（3.8）。欄を黙って消さない -->
						<p class="text-muted text-sm">
							<b
								>{{
									segment.routeCount
								}}本のルートがこの区間を使っているので、出発駅・到着駅は変えられない。</b
							>
							差し替えると、そのルートすべてが誰も触っていないのに別の経路になる。
							<b>先にそのルートからこの区間を外す。</b>
						</p>
					</template>
					<template v-else>
						<StationPicker
							v-model="fromStationId"
							label="出発駅"
							:stations="stations"
							@stations-changed="emit('stationsChanged')"
						/>
						<StationPicker
							v-model="toStationId"
							label="到着駅"
							:stations="stations"
							@stations-changed="emit('stationsChanged')"
						/>
					</template>
					<UFormField label="片道運賃（円）">
						<!-- type="number" にしない。フォーカスのある欄の上でホイールを回すと値が変わる（utils/digits.ts） -->
						<UInput
							v-model="oneWayFare"
							type="text"
							inputmode="numeric"
							pattern="[0-9]*"
							class="w-full"
						/>
					</UFormField>
					<UButton type="submit" :loading="saving" block>この内容で直す</UButton>
				</form>

				<!-- 消せないときこそ理由を出す（3.8）。ボタンを黙って消さない -->
				<p v-if="inUse" class="text-muted text-sm">
					<b>{{ segment.routeCount }}本のルートがこの区間を使っているので、削除できない。</b>
					<b>先にそのルートからこの区間を外す。</b>
				</p>
				<UButton v-else color="error" variant="subtle" :loading="deleting" block @click="remove">
					この区間を削除する
				</UButton>
			</div>
		</template>
	</USlideover>
</template>

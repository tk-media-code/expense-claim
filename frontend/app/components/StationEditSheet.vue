<script setup lang="ts">
import type { Station } from '~/types/station';

// 「この駅」のシート（02-screens.md 3.8）。
//
// 名前は使われていても直せる。削除はどの区間も使っていないときだけ（決定22）。
// 消せないときはボタンを黙って消さず、理由と「先に何をすれば消せるか」を出す（3.8）。
const props = defineProps<{ station: Station | null }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const name = ref('');
const saving = ref(false);
const deleting = ref(false);

// 開いた駅の名前を入力欄の初期値にする。失敗では閉じないので、開き直したときだけ入れ直す。
watch(
	() => (open.value ? props.station : null),
	(station) => {
		if (station) name.value = station.name;
	},
	{ immediate: true },
);

async function save() {
	if (!props.station) return;
	saving.value = true;
	try {
		await api<Station>(`/stations/${props.station.id}`, {
			method: 'PUT',
			body: { name: name.value },
		});
		open.value = false;
		emit('changed');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している。閉じないことだけをする。
	} finally {
		saving.value = false;
	}
}

async function remove() {
	if (!props.station) return;
	deleting.value = true;
	try {
		await api(`/stations/${props.station.id}`, { method: 'DELETE' });
		open.value = false;
		emit('changed');
	} catch {
		// 使用中なら 409 STATION_IN_USE。ボタンを出していないので本来ここへは来ない（二重の網）。
	} finally {
		deleting.value = false;
	}
}
</script>

<template>
	<USlideover v-model:open="open" side="bottom" title="この駅">
		<template #body>
			<div v-if="station" class="space-y-4">
				<form class="space-y-4" @submit.prevent="save">
					<UFormField label="駅名">
						<UInput v-model="name" class="w-full" />
					</UFormField>
					<dl class="flex gap-2 text-sm">
						<dt class="text-muted">使用中</dt>
						<dd>{{ station.segmentCount }}区間</dd>
					</dl>
					<UButton type="submit" :loading="saving" block>この名前で直す</UButton>
				</form>

				<!-- 消せないときこそ理由を出す（3.8）。ボタンを黙って消さない -->
				<p v-if="station.segmentCount > 0" class="text-muted text-sm">
					<b>{{ station.segmentCount }}区間がこの駅を使っているので、削除できない。</b>
					消せてしまうと区間が壊れる。<b>先にその区間を消す。</b>
				</p>
				<UButton v-else color="error" variant="subtle" :loading="deleting" block @click="remove">
					この駅を削除する
				</UButton>
			</div>
		</template>
	</USlideover>
</template>

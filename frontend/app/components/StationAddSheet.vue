<script setup lang="ts">
import type { Station } from '~/types/station';

// 「駅を登録」のシート（02-screens.md 3.8）。
// 画面を替えずに重ねて出す（2.1）ので URL を持たない。1-8 の「区間を追加」からも重ねて使う。
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const name = ref('');
const saving = ref(false);

// 開くたびに打ちかけを捨てる。失敗では閉じないので、捨ててよいのは開き直したときだけである。
watch(open, (isOpen) => {
	if (isOpen) name.value = '';
});

async function submit() {
	saving.value = true;
	try {
		await api<Station>('/stations', { method: 'POST', body: { name: name.value } });
		open.value = false;
		emit('changed');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している（04-api.md 2.5）。
		// ここでやるのは「閉じない」ことだけ。閉じると打った名前ごと消える。
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<USlideover v-model:open="open" side="bottom" title="駅を登録">
		<template #body>
			<form class="space-y-4" @submit.prevent="submit">
				<UFormField label="駅名">
					<UInput v-model="name" class="w-full" placeholder="X鉄辛駅" autofocus />
				</UFormField>
				<p class="text-muted text-sm">
					<b>鉄道会社の略称込みで入れる</b>（F-15）。乗換駅は会社ごとに別の駅として書かれるので、
					<code>X鉄乙駅</code> と
					<code>Y鉄乙駅</code> は<b>別の駅として登録する。</b>名寄せはしない。
				</p>
				<UButton type="submit" :loading="saving" block>登録する</UButton>
			</form>
		</template>
	</USlideover>
</template>

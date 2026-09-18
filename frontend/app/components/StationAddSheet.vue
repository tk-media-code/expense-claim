<script setup lang="ts">
import type { Station } from '~/types/station';

// 「駅を登録」のシート（02-screens.md 3.8）。
// 画面を替えずに重ねて出す（2.1）ので URL を持たない。1-8 の「区間を追加」からも重ねて使う。
const open = defineModel<boolean>('open', { required: true });
// 登録した駅を添えて知らせる。区間のシートから重ねて開いたとき、そのまま選択状態にするため（3.8）
const emit = defineEmits<{ changed: [station: Station] }>();

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
		const created = await api<Station>('/stations', {
			method: 'POST',
			body: { name: name.value },
		});
		open.value = false;
		emit('changed', created);
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
				<UButton type="submit" :loading="saving" block>登録する</UButton>
			</form>
		</template>
	</USlideover>
</template>

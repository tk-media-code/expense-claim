<script setup lang="ts">
import type { Venue } from '~/types/venue';

// 「会場を追加」のシート（02-screens.md 3.6 / F-14）。
// マスタに無い会場コードが実際に来る（要求分析 6.5）。マスタだけを使う作りにすると、
// その会場にルートを紐付けられず、記録そのものができない。
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ changed: [venue: Venue] }>();

const api = useApi();
const code = ref('');
const name = ref('');
const saving = ref(false);

// 開くたびに打ちかけを捨てる。失敗では閉じないので、捨ててよいのは開き直したときだけである。
watch(open, (isOpen) => {
	if (isOpen) {
		code.value = '';
		name.value = '';
	}
});

async function submit() {
	saving.value = true;
	try {
		const created = await api<Venue>('/venues', {
			method: 'POST',
			body: { code: code.value, name: name.value },
		});
		open.value = false;
		emit('changed', created);
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している（04-api.md 2.5）。
		// ここでやるのは「閉じない」ことだけ。閉じると打った内容ごと消える。
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<USlideover v-model:open="open" side="bottom" title="会場を追加">
		<template #body>
			<form class="space-y-4" @submit.prevent="submit">
				<UFormField label="会場コード">
					<UInput v-model="code" class="w-full" placeholder="DDD" autofocus />
				</UFormField>
				<UFormField label="会場名">
					<UInput v-model="name" class="w-full" placeholder="丁会館" />
				</UFormField>
				<UButton type="submit" :loading="saving" block>追加する</UButton>
			</form>
		</template>
	</USlideover>
</template>

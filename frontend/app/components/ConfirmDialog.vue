<script setup lang="ts">
// 取り消せない操作の前に挟む確認（02-screens.md 3.3「確認を挟む」）。
// 何が起きるかを本文に書く。確認ダイアログの中身が「本当によいですか」だけだと、押す側は何を確かめればよいか分からない。
defineProps<{
	title: string;
	/** 消えるもの・消えないものを書く */
	description: string;
	confirmLabel: string;
	loading?: boolean;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
	<UModal v-model:open="open" :title="title" :description="description">
		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton variant="ghost" color="neutral" @click="open = false">やめる</UButton>
				<UButton color="error" :loading="loading" @click="emit('confirm')">{{
					confirmLabel
				}}</UButton>
			</div>
		</template>
	</UModal>
</template>

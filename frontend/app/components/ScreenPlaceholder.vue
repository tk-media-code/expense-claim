<script setup lang="ts">
defineProps<{
	/** 実装計画のタスク番号。例: `3-6` */
	phase: string;
	/** `02-screens.md` の節。例: `3.2` */
	spec: string;
}>();
</script>

<template>
	<div>
		<p class="text-muted text-sm">
			この画面は Phase {{ phase }} で作る（<code>02-screens.md</code> {{ spec }}）。
		</p>
		<div v-if="$slots.default" class="mt-4">
			<slot />
		</div>
	</div>
</template>

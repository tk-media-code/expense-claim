<script setup lang="ts">
const toast = useToast();
const count = ref(0);

function press() {
	count.value += 1;
	toast.add({ title: '押した回数', description: `${count.value} 回`, color: 'primary' });
}
</script>

<template>
	<UCard>
		<template #header>
			<h1 class="text-lg font-semibold">UI 基盤の動作確認</h1>
		</template>

		<p class="text-muted text-sm">
			Nuxt UI の既定テーマで描画している。ここは画面実装まで置く仮のページで、ホーム（<code
				>02-screens.md</code
			>
			3.2）に置き換わる。
		</p>

		<p class="mt-4 text-sm">
			押した回数: <span data-testid="count" class="font-semibold">{{ count }}</span>
		</p>

		<template #footer>
			<UButton data-testid="press" icon="i-lucide-check" @click="press">押す</UButton>
		</template>
	</UCard>
</template>

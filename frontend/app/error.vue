<script setup lang="ts">
import type { NuxtError } from '#app';
import { ja } from '@nuxt/ui/locale';

defineProps<{
	error: NuxtError;
}>();

function goHome() {
	void clearError({ redirect: '/' });
}

useHead({
	title: '画面が見つかりません',
});
</script>

<template>
	<!-- error.vue は app.vue の外で描画されるので UApp を自分で持つ。 -->
	<UApp :locale="ja">
		<div class="bg-default text-default min-h-screen">
			<main class="mx-auto w-full max-w-screen-sm px-4 py-6">
				<h1 class="text-lg font-semibold">画面が見つかりません</h1>
				<UButton class="mt-4" @click="goHome">ホームへ</UButton>
			</main>
		</div>
	</UApp>
</template>

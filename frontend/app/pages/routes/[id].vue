<script setup lang="ts">
import type { Route } from '~/types/route';

definePageMeta({
	title: 'ルートの編集',
	back: '/venues',
});

const route = useRoute();
const { data, status, error, refresh } = await useApiFetch<Route>(
	`/routes/${String(route.params.id)}`,
);
</script>

<template>
	<div v-if="status === 'pending'" class="space-y-2">
		<USkeleton v-for="n in 3" :key="n" class="h-10 w-full" />
	</div>
	<div v-else-if="error || !data" class="space-y-3">
		<p class="text-muted text-sm">ルートを読み込めませんでした。</p>
		<UButton variant="outline" @click="refresh()">もう一度読み込む</UButton>
	</div>
	<RouteEditor v-else :route="data" />
</template>

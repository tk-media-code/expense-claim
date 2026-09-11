<script setup lang="ts">
definePageMeta({
	title: '案件の詳細',
	back: '/',
});

const route = useRoute();
</script>

<template>
	<ScreenPlaceholder phase="3-8" spec="3.3">
		<UButton :to="`/projects/${route.params.id}/record?from=detail`">記録する</UButton>
	</ScreenPlaceholder>
</template>

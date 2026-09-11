<script setup lang="ts">
definePageMeta({
	title: '交通費の記録',
	back: (route) => (route.query.from === 'detail' ? `/projects/${route.params.id}` : '/'),
});
</script>

<template>
	<ScreenPlaceholder phase="4-4" spec="3.5">
		<UButton to="/venues">会場とルートを開く</UButton>
	</ScreenPlaceholder>
</template>

<script setup lang="ts">
definePageMeta({
	title: 'ルートの編集',
	back: '/venues',
});

// 会場とルートの画面の「ルートを追加」から来たときは、その会場が選ばれている（2-6）
const route = useRoute();
const raw = Number(route.query.venueId);
const defaultVenueId = Number.isInteger(raw) && raw > 0 ? raw : undefined;
</script>

<template>
	<RouteEditor :route="null" :default-venue-id="defaultVenueId" />
</template>

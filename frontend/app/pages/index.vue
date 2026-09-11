<script setup lang="ts">
definePageMeta({
	title: 'ホーム',
	menu: true,
});
</script>

<template>
	<ScreenPlaceholder phase="3-6" spec="3.2">
		<UCard>
			<template #header>
				<NuxtLink to="/projects/1" class="block">
					<p class="font-semibold">AAA 甲ホール</p>
					<p class="text-muted text-sm">9/5 · 〇〇様△△様</p>
				</NuxtLink>
			</template>
			<p class="text-muted text-sm">Phase 3-6 で置き換わる仮の案件カード。</p>
			<template #footer>
				<UButton to="/projects/1/record">記録する</UButton>
			</template>
		</UCard>
		<div class="mt-4">
			<UButton to="/submit" variant="outline">提出</UButton>
		</div>
	</ScreenPlaceholder>
</template>

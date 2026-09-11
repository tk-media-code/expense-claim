<script setup lang="ts">
import { ja } from '@nuxt/ui/locale';
</script>

<template>
	<!-- UApp は Nuxt UI のトースト・モーダル・ツールチップの土台。最上位に1つ置く。 -->
	<UApp :locale="ja">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>

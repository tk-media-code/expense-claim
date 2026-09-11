<script setup lang="ts">
const route = useRoute();

const title = computed(() => route.meta.title ?? '');
const backTo = computed(() => backOf(route));
const showMenu = computed(() => route.meta.menu === true);

useHead({
	title,
});

const menuItems = [
	[
		{ label: '会場とルート', to: '/venues', icon: 'i-lucide-map-pin' },
		{ label: '区間と運賃', to: '/segments', icon: 'i-lucide-route' },
		{ label: '要確認事項', to: '/attentions', icon: 'i-lucide-bell' },
		{ label: '設定', to: '/settings', icon: 'i-lucide-settings' },
	],
];
</script>

<template>
	<div class="bg-default text-default min-h-screen">
		<header class="border-default border-b">
			<div class="mx-auto flex max-w-screen-sm items-center gap-2 px-4 py-3">
				<UButton
					v-if="backTo"
					:to="backTo"
					icon="i-lucide-chevron-left"
					variant="ghost"
					color="neutral"
					aria-label="戻る"
				/>
				<UIcon v-else name="i-lucide-train-front" class="text-primary size-5" />
				<h1 class="min-w-0 flex-1 truncate font-semibold">{{ title }}</h1>
				<template v-if="showMenu">
					<UButton to="/projects/new" icon="i-lucide-plus" class="shrink-0">案件を追加</UButton>
					<UDropdownMenu :items="menuItems">
						<UButton icon="i-lucide-menu" variant="ghost" color="neutral" aria-label="メニュー" />
					</UDropdownMenu>
				</template>
			</div>
		</header>

		<!-- スマートフォンのブラウザが主、PC が従（NF-01）。既定を狭い幅に置く。 -->
		<main class="mx-auto w-full max-w-screen-sm px-4 py-6">
			<slot />
		</main>
	</div>
</template>

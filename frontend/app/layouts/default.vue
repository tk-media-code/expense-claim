<template>
	<div class="bg-default text-default min-h-screen">
		<header class="border-default border-b">
			<div class="mx-auto flex max-w-screen-sm items-center gap-2 px-4 py-3">
				<UIcon name="i-lucide-train-front" class="text-primary size-5" />
				<span class="font-semibold">交通費精算</span>
			</div>
		</header>

		<!-- スマートフォンのブラウザが主、PC が従（NF-01）。既定を狭い幅に置く。 -->
		<main class="mx-auto w-full max-w-screen-sm px-4 py-6">
			<slot />
		</main>
	</div>
</template>

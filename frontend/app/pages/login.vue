<script setup lang="ts">
definePageMeta({
	title: 'ログイン',
});

// ログインに Gmail・ドライブ・スプレッドシートのスコープを求めない（01-architecture.md 3.7）。
// ここで確かめるのは本人かどうかだけ。同意画面へは SPA の中ではなく、ページごと移る
const route = useRoute();
// 許可されたアカウント以外のときの拒否メッセージ（3.1 / N-03）。バックエンドが /login?error=… へ戻す
const error = computed(() => {
	const value = route.query.error;
	return typeof value === 'string' && value !== '' ? value : null;
});

function login() {
	window.location.href = '/api/auth/login';
}
</script>

<template>
	<div class="space-y-6">
		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="i-lucide-shield-x"
			title="ログインできませんでした"
			:description="error"
			data-testid="login-error"
		/>
		<UButton icon="i-lucide-log-in" size="lg" block data-testid="login" @click="login">
			Google でログイン
		</UButton>
	</div>
</template>

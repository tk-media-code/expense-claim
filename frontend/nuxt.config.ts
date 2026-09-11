export default defineNuxtConfig({
	modules: ['@nuxt/eslint', '@nuxt/ui'],
	ssr: false,
	css: ['~/assets/css/main.css'],
	app: {
		head: {
			title: 'expense-claim',
			titleTemplate: '%s | expense-claim',
		},
	},
	// OS のダーク設定に引っ張られない。初回はライト。切替はアプリバー（02-screens.md 7章）。
	colorMode: {
		preference: 'light',
		fallback: 'light',
	},
	compatibilityDate: '2026-09-09',
});

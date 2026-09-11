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
	compatibilityDate: '2026-09-09',
});

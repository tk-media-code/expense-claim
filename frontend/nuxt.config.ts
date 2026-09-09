export default defineNuxtConfig({
	modules: ['@nuxt/eslint'],
	ssr: false,
	app: {
		head: {
			title: 'expense-claim',
		},
	},
	compatibilityDate: '2026-09-09',
});

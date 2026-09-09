import { defineVitestConfig } from '@nuxt/test-utils/config';

// Nuxt の環境ごと立ち上げる。auto-import と composable がテストでも同じに解決される。
export default defineVitestConfig({
	test: {
		environment: 'nuxt',
		environmentOptions: {
			nuxt: { domEnvironment: 'happy-dom' },
		},
		include: ['app/**/*.test.ts'],
	},
});

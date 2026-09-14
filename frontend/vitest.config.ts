import { defineVitestConfig } from '@nuxt/test-utils/config';

// Nuxt の環境ごと立ち上げる。auto-import と composable がテストでも同じに解決される。
export default defineVitestConfig({
	test: {
		environment: 'nuxt',
		environmentOptions: {
			nuxt: { domEnvironment: 'happy-dom' },
		},
		include: ['app/**/*.test.ts'],
		// 全画面に掛かる認証の middleware を、ログイン済みとして通す
		setupFiles: ['./test/setup.ts'],
	},
});

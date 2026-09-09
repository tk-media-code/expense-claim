import { defineConfig } from 'vitest/config';

// unit と integration を分ける（07-development.md 4章）。
// integration だけが実 MySQL を要る。unit は DB を触らない。
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'unit',
					include: ['src/**/*.test.ts'],
					exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
				},
			},
			{
				test: {
					name: 'integration',
					include: ['src/**/*.integration.test.ts'],
					globalSetup: ['./test/global-setup.ts'],
					// 同じテスト用スキーマを共有するので、ファイル間で並行させない。
					fileParallelism: false,
				},
			},
		],
	},
});

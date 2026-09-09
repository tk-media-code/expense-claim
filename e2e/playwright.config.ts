import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

// nginx 越しに、フロントとバックの両方をまたいで叩く。
// frontend にも backend にも属さないので、リポジトリ直下に置いている。
export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	reporter: process.env.CI ? 'list' : [['list']],
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	// NF-01「スマートフォンのブラウザが主、PC が従」。既定を実機に寄せる。
	projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
	webServer: {
		command: 'docker compose up -d --wait',
		cwd: '..',
		url: baseURL,
		reuseExistingServer: true,
		timeout: 300_000,
	},
});

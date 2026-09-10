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
		// `up -d --wait` は完了と同時にプロセスが終了する。Playwright は URL の応答より先に
		// プロセス終了を検知すると `exited early` で落とすので、そのままだと競合する。
		// quality-check.sh は統合テストのために mysql だけを先に起動しており、この状態だと
		// `--wait` が早く返るため終了検知がほぼ必ず先行した（#80）。
		// ログの追従でプロセスを生かし続けて競合を消す。E2E の出力に nginx のログも出る。
		command: 'docker compose up -d --wait && docker compose logs -f nginx',
		cwd: '..',
		url: baseURL,
		reuseExistingServer: true,
		timeout: 300_000,
	},
});

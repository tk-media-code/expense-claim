import { createAlertRunner } from './alert-runner.js';
import { loadEnv } from './config/env.js';
import { createDatabase, createPool } from './db/client.js';
import { parseSchedulerArgs } from './scheduler-args.js';

// 提出アラートの定期実行（01-architecture.md 3.8 / 要件定義 7.5）。cron は1本だけで、これがそれ。
//
// `node dist/scheduler.js`                起動時に1回走り、以後は毎日 07:00（JST）に走る。コンテナはこれで常駐する
// `node dist/scheduler.js --once`         1回走って終わる（手で確かめるとき）
// `node dist/scheduler.js --at=2026-10-01` その日の 07:00（JST）として1回走って終わる。1日と3日の朝にしか
//                                         送らないので、送る側を手で確かめるにはこれで日付を与える（scheduler-args.ts）
//
// crond を使わないのは、コンテナが node ユーザーで動き（07-development.md 2.5）、busybox の crond が
// root を要るため。1日1回の判定と送信だけなので、時刻まで眠って起きる1プロセスで足りる。
// 「起動するたびに last_cron_run_at を更新する」（06-error-handling.md 7.2）は、毎日の起床のたびに当てる

const RUN_AT_HOUR_JST = 7;

function nextRun(now: Date): Date {
	const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
	const next = new Date(
		Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), RUN_AT_HOUR_JST - 9, 0, 0),
	);
	if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
	return next;
}

const args = parseSchedulerArgs(process.argv.slice(2));
const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const alert = createAlertRunner(createDatabase(pool), {
	sessionSecret: env.SESSION_SECRET,
	allowedEmail: env.ALLOWED_EMAIL,
	tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
	google: {
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
		redirectUriLogin: env.GOOGLE_REDIRECT_URI_LOGIN,
		redirectUriAuthorization: env.GOOGLE_REDIRECT_URI_AUTHORIZATION,
	},
	googleStub: env.GOOGLE_STUB,
	spreadsheetId: env.SPREADSHEET_ID,
	sheetName: env.MY_SHEET_NAME,
	gmailSender: env.GMAIL_SENDER,
	alertTo: env.ALERT_TO,
	driveFolderId: env.DRIVE_FOLDER_ID,
	appUrl: env.APP_URL,
});

async function runOnce(now: Date): Promise<void> {
	try {
		const outcome = await alert.run(now);
		console.log(`[scheduler] ${now.toISOString()} ${JSON.stringify(outcome)}`);
	} catch (cause) {
		// 落ちても常駐は続ける。落ちたことはログに残り、cron の死活は次の起床で更新される
		console.error('[scheduler] failed', cause);
	}
}

async function main(): Promise<void> {
	await runOnce(args.now ?? new Date());
	if (args.once) {
		await pool.end();
		return;
	}
	for (;;) {
		const at = nextRun(new Date());
		console.log(`[scheduler] next run at ${at.toISOString()}`);
		await new Promise((resolve) => setTimeout(resolve, at.getTime() - Date.now()));
		await runOnce(new Date());
	}
}

void main();

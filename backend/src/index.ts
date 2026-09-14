import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase, createPool } from './db/client.js';

// 起動処理はこのファイルにだけ置く。テストは app.ts を import する。
const env = loadEnv();
const app = createApp({
	db: createDatabase(createPool(env.DATABASE_URL)),
	config: {
		sessionSecret: env.SESSION_SECRET,
		allowedEmail: env.ALLOWED_EMAIL,
		tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
		google: {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
			redirectUriLogin: env.GOOGLE_REDIRECT_URI_LOGIN,
			redirectUriAuthorization: env.GOOGLE_REDIRECT_URI_AUTHORIZATION,
		},
		spreadsheetId: env.SPREADSHEET_ID,
		sheetName: env.MY_SHEET_NAME,
		gmailSender: env.GMAIL_SENDER,
		alertTo: env.ALERT_TO,
	},
});

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
	console.log(`listening on ${info.address}:${info.port}`);
});

import type { AppConfig } from './app.js';
import type { Database } from './db/client.js';
import { createGmailClient } from './integrations/gmail/googleapis.js';
import { createGoogleAuth } from './integrations/google/auth-googleapis.js';
import { createSheetsClient } from './integrations/sheets/googleapis.js';
import { createStubGoogle } from './integrations/stub/index.js';
import { createAttentionsRepository } from './repositories/attentions.js';
import { createExpenseRecordsRepository } from './repositories/expense-records.js';
import { createGoogleCredentialsRepository } from './repositories/google-credentials.js';
import { createProjectsRepository } from './repositories/projects.js';
import { createSubmissionsRepository } from './repositories/submissions.js';
import { createSyncStateRepository } from './repositories/sync-state.js';
import { createAlertService, type AlertService } from './services/alert.js';
import { createAttentionsService } from './services/attentions.js';

// scheduler コンテナが使う組み立て（01-architecture.md 3.8）。backend と同じイメージを別コマンドで起動し、
// 同じ DB と同じ認可（google_credentials）を読む。HTTP を持たないので、外から叩ける入口が生まれない（04-api.md 7章）
export function createAlertRunner(
	db: Database,
	config: AppConfig & { appUrl: string },
): AlertService {
	const stub = config.googleStub ? createStubGoogle() : null;
	const google =
		stub?.auth ??
		createGoogleAuth(
			{
				clientId: config.google.clientId,
				clientSecret: config.google.clientSecret,
				redirectUri: config.google.redirectUriAuthorization,
				tokenEncryptionKey: config.tokenEncryptionKey,
			},
			createGoogleCredentialsRepository(db),
		);
	const sheets =
		stub?.sheets ??
		createSheetsClient(google, {
			spreadsheetId: config.spreadsheetId,
			sheetName: config.sheetName,
		});
	const gmail =
		stub?.gmail ??
		createGmailClient(google, { sender: config.gmailSender, alertTo: config.alertTo });
	return createAlertService(
		sheets,
		gmail,
		createSyncStateRepository(db),
		createSubmissionsRepository(db),
		createProjectsRepository(db),
		createExpenseRecordsRepository(db),
		createAttentionsService(createAttentionsRepository(db)),
		{ appUrl: config.appUrl },
	);
}

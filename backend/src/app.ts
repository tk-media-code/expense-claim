import { Hono } from 'hono';
import { logger } from 'hono/logger';

import type { Database } from './db/client.js';
import { AppError } from './domain/app-error.js';
import type { DriveClient } from './integrations/drive/client.js';
import { createDriveClient } from './integrations/drive/googleapis.js';
import type { GmailClient } from './integrations/gmail/client.js';
import { createGmailClient } from './integrations/gmail/googleapis.js';
import type {
	GoogleAuthorizationClient,
	GoogleClientProvider,
} from './integrations/google/auth.js';
import { createGoogleAuth } from './integrations/google/auth-googleapis.js';
import type { LoginProvider } from './integrations/google/oauth.js';
import { createGoogleLoginProvider } from './integrations/google/oauth-googleapis.js';
import type { SheetsClient } from './integrations/sheets/client.js';
import { createSheetsClient } from './integrations/sheets/googleapis.js';
import { createStubGoogle } from './integrations/stub/index.js';
import { createAttentionsRepository } from './repositories/attentions.js';
import { createAuthStateRepository } from './repositories/auth-state.js';
import { createConfigBackupRepository } from './repositories/config-backup.js';
import { createGoogleCredentialsRepository } from './repositories/google-credentials.js';
import { createImportedMailsRepository } from './repositories/imported-mails.js';
import { createExpenseRecordsRepository } from './repositories/expense-records.js';
import { createProjectsRepository } from './repositories/projects.js';
import { createRoutesRepository } from './repositories/routes.js';
import { createSegmentsRepository } from './repositories/segments.js';
import { createStationsRepository } from './repositories/stations.js';
import { createSubmissionsRepository } from './repositories/submissions.js';
import { createSyncStateRepository } from './repositories/sync-state.js';
import { createTaxiRidesRepository } from './repositories/taxi-rides.js';
import { createVenuesRepository } from './repositories/venues.js';
import { createAttentionsRoute } from './routes/attentions.js';
import { createAuthRoute } from './routes/auth.js';
import { createConfigBackupRoute } from './routes/config-backup.js';
import { handleError, handleNotFound } from './routes/error-handler.js';
import { createExpenseRecordsRoute } from './routes/expense-records.js';
import { createGoogleAuthorizationRoute } from './routes/google-authorization.js';
import { healthRoute } from './routes/health.js';
import { createHomeRoute } from './routes/home.js';
import { createProjectsRoute } from './routes/projects.js';
import { requireSession } from './routes/require-session.js';
import { createRoutesRoute } from './routes/routes.js';
import { createSegmentsRoute } from './routes/segments.js';
import { createSettingsRoute } from './routes/settings.js';
import { createSubmissionsRoute } from './routes/submissions.js';
import { createSyncRoute } from './routes/sync.js';
import { createTaxiRidesRoute } from './routes/taxi-rides.js';
import { createStationsRoute } from './routes/stations.js';
import { createVenuesRoute } from './routes/venues.js';
import { createAttentionsService } from './services/attentions.js';
import { createAuthService } from './services/auth.js';
import { createConfigBackupService } from './services/config-backup.js';
import { createExpenseRecordsService } from './services/expense-records.js';
import { createGoogleAuthorizationService } from './services/google-authorization.js';
import { createHomeService } from './services/home.js';
import { createProjectsService } from './services/projects.js';
import { createRoutesService } from './services/routes.js';
import { createSegmentsService } from './services/segments.js';
import { createSettingsService } from './services/settings.js';
import { createSubmissionsService } from './services/submissions.js';
import { createSyncService } from './services/sync.js';
import { createTaxiRidesService } from './services/taxi-rides.js';
import { createStationsService } from './services/stations.js';
import { createVenuesService } from './services/venues.js';

/** 環境変数から組む設定のうち、アプリが要るもの。index.ts が env から写し、テストは固定値を渡す */
export type AppConfig = {
	sessionSecret: string;
	allowedEmail: string;
	tokenEncryptionKey: string;
	google: {
		clientId: string;
		clientSecret: string;
		redirectUriLogin: string;
		redirectUriAuthorization: string;
	};
	/** Google を叩かない開発用の実装に差し替える（integrations/stub）。本番では常に false */
	googleStub: boolean;
	/** 提出シートなどの環境依存値（05-integration.md 9章）。空なら未設定 */
	spreadsheetId: string;
	sheetName: string;
	gmailSender: string;
	alertTo: string;
	driveFolderId: string;
};

// アプリが外から受け取るもの。index.ts は本物の DB と Google を、統合テストは test スキーマの DB と偽物を渡す。
export type AppDependencies = {
	db: Database;
	config: AppConfig;
	/** 省くと config.google から googleapis の実装を組む。テストは偽物を渡す */
	loginProvider?: LoginProvider;
	/** 省くと config.google から googleapis の実装を組む。テストは偽物を渡す */
	googleAuth?: GoogleAuthorizationClient & GoogleClientProvider;
	/** 省くと googleapis の実装を組む。テストは偽物を渡す */
	sheetsClient?: SheetsClient;
	gmailClient?: GmailClient;
	driveClient?: DriveClient;
};

// OAuth クライアントが設定されていない環境（ローカルの E2E など）では、ログインの入口だけが使えない。
// セッション Cookie を直接載せれば他は動く
function unconfiguredLoginProvider(): LoginProvider {
	const fail = () => {
		throw new AppError('INTERNAL_ERROR', { message: 'Google のログインが設定されていません' });
	};
	return { authorizationUrl: fail, exchange: () => Promise.reject(fail()) };
}

// ログは標準出力へ1行テキストで出し、Docker に拾わせる（07-development.md 6章）。
export function createApp({
	db,
	config,
	loginProvider,
	googleAuth,
	sheetsClient,
	gmailClient,
	driveClient,
}: AppDependencies): Hono {
	const app = new Hono();
	app.use('*', logger());

	// 組み立てはここだけで行う。routes が受け取るのは services だけである（01-architecture.md 5.2）。
	const stationsRepository = createStationsRepository(db);
	const segmentsRepository = createSegmentsRepository(db);
	const venuesRepository = createVenuesRepository(db);
	const stationsService = createStationsService(stationsRepository);
	// 区間の登録は駅の存在を先読みするので、駅の repository を共有する（ルートも同じ形）
	const segmentsService = createSegmentsService(segmentsRepository, stationsRepository);
	const routesRepository = createRoutesRepository(db);
	const routesService = createRoutesService(routesRepository, venuesRepository, segmentsRepository);
	const projectsRepository = createProjectsRepository(db);
	const expenseRecordsRepository = createExpenseRecordsRepository(db);
	const taxiRidesRepository = createTaxiRidesRepository(db);
	// 案件は会場コードから会場名を引き、詳細は記録の要約とルート名を添える（02-screens.md 3.3）
	const projectsService = createProjectsService(
		projectsRepository,
		venuesRepository,
		expenseRecordsRepository,
		routesRepository,
		taxiRidesRepository,
	);
	const syncStateRepository = createSyncStateRepository(db);
	const attentionsRepository = createAttentionsRepository(db);
	const attentionsService = createAttentionsService(attentionsRepository);
	const submissionsRepository = createSubmissionsRepository(db);
	const homeService = createHomeService(
		projectsRepository,
		syncStateRepository,
		expenseRecordsRepository,
		attentionsRepository,
		taxiRidesRepository,
		submissionsRepository,
	);
	// 記録は案件 → 会場 → ルートと辿って既定値を組む（04-api.md 5.2）
	const expenseRecordsService = createExpenseRecordsService(
		expenseRecordsRepository,
		projectsRepository,
		venuesRepository,
		routesRepository,
		taxiRidesRepository,
	);
	const provider =
		loginProvider ??
		(config.google.clientId
			? createGoogleLoginProvider({
					clientId: config.google.clientId,
					clientSecret: config.google.clientSecret,
					redirectUri: config.google.redirectUriLogin,
				})
			: unconfiguredLoginProvider());
	const authService = createAuthService(provider, createAuthStateRepository(db), {
		allowedEmail: config.allowedEmail,
	});
	// GOOGLE_STUB=1 なら Google を叩かない開発用の実装（E2E と、OAuth クライアントを持たない開発環境）
	const stub = config.googleStub ? createStubGoogle() : null;
	// Google API の認可（05-integration.md 2.3）。トークンはこの中に閉じ、services は有無しか知らない
	const google =
		googleAuth ??
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
	const googleAuthorizationService = createGoogleAuthorizationService(google);
	// 提出シート（05-integration.md 7章 / 8章）。書き込み先は環境変数で、実行時に決めない
	const sheets =
		sheetsClient ??
		stub?.sheets ??
		createSheetsClient(google, {
			spreadsheetId: config.spreadsheetId,
			sheetName: config.sheetName,
		});
	const venuesService = createVenuesService(venuesRepository, sheets);
	const settingsService = createSettingsService(syncStateRepository, google, sheets, {
		sheetName: config.sheetName,
	});
	const gmail =
		gmailClient ??
		stub?.gmail ??
		createGmailClient(google, { sender: config.gmailSender, alertTo: config.alertTo });
	// 領収書はドライブへ保存し、通って初めて DB に書く（F-26）
	const drive =
		driveClient ?? stub?.drive ?? createDriveClient(google, { folderId: config.driveFolderId });
	const taxiRidesService = createTaxiRidesService(
		taxiRidesRepository,
		projectsRepository,
		drive,
		attentionsService,
	);
	const taxiRidesRoute = createTaxiRidesRoute(taxiRidesService);
	// 提出（04-api.md 6章）。確認と実行の2段構えで、書き込み先は環境変数で決まる
	const submissionsService = createSubmissionsService(
		sheets,
		projectsRepository,
		expenseRecordsRepository,
		taxiRidesRepository,
		submissionsRepository,
		attentionsRepository,
		attentionsService,
	);
	const syncService = createSyncService(
		sheets,
		gmail,
		syncStateRepository,
		createImportedMailsRepository(db),
		projectsRepository,
		attentionsService,
	);

	// 本人以外は使えない（NF-06）。/api/health とログインの入口だけを除いて、全部に被せる
	app.use('/api/*', requireSession(authService, config.sessionSecret));

	app.route('/api/health', healthRoute);
	app.route('/api/auth', createAuthRoute(authService, { sessionSecret: config.sessionSecret }));
	app.route('/api/home', createHomeRoute(homeService));
	app.route('/api/sync', createSyncRoute(syncService));
	app.route('/api/submissions', createSubmissionsRoute(submissionsService));
	app.route('/api/stations', createStationsRoute(stationsService));
	app.route('/api/segments', createSegmentsRoute(segmentsService));
	app.route('/api/venues', createVenuesRoute(venuesService));
	app.route('/api/routes', createRoutesRoute(routesService));
	app.route('/api/projects', createProjectsRoute(projectsService));
	app.route('/api/projects', createExpenseRecordsRoute(expenseRecordsService));
	app.route('/api/projects', taxiRidesRoute.projects);
	app.route('/api/taxi-rides', taxiRidesRoute.taxiRides);
	app.route(
		'/api/google/authorization',
		createGoogleAuthorizationRoute(googleAuthorizationService, {
			sessionSecret: config.sessionSecret,
		}),
	);
	app.route('/api/settings', createSettingsRoute(settingsService));
	// 設定データの控え（NF-11）。/api/settings の下に載せる
	app.route(
		'/api/settings/config-backup',
		createConfigBackupRoute(createConfigBackupService(createConfigBackupRepository(db))),
	);
	app.route('/api/attentions', createAttentionsRoute(attentionsService));
	// 失敗は必ず 04-api.md 2.5 の形で返す。ここを通らない経路を作らない。
	app.onError(handleError);
	app.notFound(handleNotFound);
	return app;
}

import { Hono } from 'hono';
import { logger } from 'hono/logger';

import type { Database } from './db/client.js';
import { createExpenseRecordsRepository } from './repositories/expense-records.js';
import { createProjectsRepository } from './repositories/projects.js';
import { createRoutesRepository } from './repositories/routes.js';
import { createSegmentsRepository } from './repositories/segments.js';
import { createStationsRepository } from './repositories/stations.js';
import { createSyncStateRepository } from './repositories/sync-state.js';
import { createVenuesRepository } from './repositories/venues.js';
import { handleError, handleNotFound } from './routes/error-handler.js';
import { createExpenseRecordsRoute } from './routes/expense-records.js';
import { healthRoute } from './routes/health.js';
import { createHomeRoute } from './routes/home.js';
import { createProjectsRoute } from './routes/projects.js';
import { createRoutesRoute } from './routes/routes.js';
import { createSegmentsRoute } from './routes/segments.js';
import { createStationsRoute } from './routes/stations.js';
import { createVenuesRoute } from './routes/venues.js';
import { createExpenseRecordsService } from './services/expense-records.js';
import { createHomeService } from './services/home.js';
import { createProjectsService } from './services/projects.js';
import { createRoutesService } from './services/routes.js';
import { createSegmentsService } from './services/segments.js';
import { createStationsService } from './services/stations.js';
import { createVenuesService } from './services/venues.js';

// アプリが外から受け取るもの。index.ts は本物の DB を、統合テストは test スキーマの DB を渡す。
export type AppDependencies = { db: Database };

// ログは標準出力へ1行テキストで出し、Docker に拾わせる（07-development.md 6章）。
export function createApp({ db }: AppDependencies): Hono {
	const app = new Hono();
	app.use('*', logger());

	// 組み立てはここだけで行う。routes が受け取るのは services だけである（01-architecture.md 5.2）。
	const stationsRepository = createStationsRepository(db);
	const segmentsRepository = createSegmentsRepository(db);
	const venuesRepository = createVenuesRepository(db);
	const stationsService = createStationsService(stationsRepository);
	// 区間の登録は駅の存在を先読みするので、駅の repository を共有する（ルートも同じ形）
	const segmentsService = createSegmentsService(segmentsRepository, stationsRepository);
	const venuesService = createVenuesService(venuesRepository);
	const routesRepository = createRoutesRepository(db);
	const routesService = createRoutesService(routesRepository, venuesRepository, segmentsRepository);
	const projectsRepository = createProjectsRepository(db);
	// 案件は会場コードから会場名を引くので、会場の repository を共有する
	const projectsService = createProjectsService(projectsRepository, venuesRepository);
	const homeService = createHomeService(projectsRepository, createSyncStateRepository(db));
	// 記録は案件 → 会場 → ルートと辿って既定値を組む（04-api.md 5.2）
	const expenseRecordsService = createExpenseRecordsService(
		createExpenseRecordsRepository(db),
		projectsRepository,
		venuesRepository,
		routesRepository,
	);

	app.route('/api/health', healthRoute);
	app.route('/api/home', createHomeRoute(homeService));
	app.route('/api/stations', createStationsRoute(stationsService));
	app.route('/api/segments', createSegmentsRoute(segmentsService));
	app.route('/api/venues', createVenuesRoute(venuesService));
	app.route('/api/routes', createRoutesRoute(routesService));
	app.route('/api/projects', createProjectsRoute(projectsService));
	app.route('/api/projects', createExpenseRecordsRoute(expenseRecordsService));
	// 失敗は必ず 04-api.md 2.5 の形で返す。ここを通らない経路を作らない。
	app.onError(handleError);
	app.notFound(handleNotFound);
	return app;
}

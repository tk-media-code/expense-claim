import { Hono } from 'hono';
import { logger } from 'hono/logger';

import type { Database } from './db/client.js';
import { createStationsRepository } from './repositories/stations.js';
import { handleError, handleNotFound } from './routes/error-handler.js';
import { healthRoute } from './routes/health.js';
import { createStationsRoute } from './routes/stations.js';
import { createStationsService } from './services/stations.js';

// アプリが外から受け取るもの。index.ts は本物の DB を、統合テストは test スキーマの DB を渡す。
export type AppDependencies = { db: Database };

// ログは標準出力へ1行テキストで出し、Docker に拾わせる（07-development.md 6章）。
export function createApp({ db }: AppDependencies): Hono {
	const app = new Hono();
	app.use('*', logger());

	// 組み立てはここだけで行う。routes が受け取るのは services だけである（01-architecture.md 5.2）。
	const stationsService = createStationsService(createStationsRepository(db));

	app.route('/api/health', healthRoute);
	app.route('/api/stations', createStationsRoute(stationsService));
	// 失敗は必ず 04-api.md 2.5 の形で返す。ここを通らない経路を作らない。
	app.onError(handleError);
	app.notFound(handleNotFound);
	return app;
}

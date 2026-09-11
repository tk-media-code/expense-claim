import { Hono } from 'hono';
import { logger } from 'hono/logger';

import { handleError, handleNotFound } from './routes/error-handler.js';
import { healthRoute } from './routes/health.js';

// ログは標準出力へ1行テキストで出し、Docker に拾わせる（07-development.md 6章）。
export function createApp(): Hono {
	const app = new Hono();
	app.use('*', logger());
	app.route('/api/health', healthRoute);
	// 失敗は必ず 04-api.md 2.5 の形で返す。ここを通らない経路を作らない。
	app.onError(handleError);
	app.notFound(handleNotFound);
	return app;
}

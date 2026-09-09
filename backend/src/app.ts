import { Hono } from 'hono';
import { logger } from 'hono/logger';

import { healthRoute } from './routes/health.js';

// ログは標準出力へ1行テキストで出し、Docker に拾わせる（07-development.md 6章）。
export function createApp(): Hono {
	const app = new Hono();
	app.use('*', logger());
	app.route('/api/health', healthRoute);
	return app;
}

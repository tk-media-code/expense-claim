import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase, createPool } from './db/client.js';

// 起動処理はこのファイルにだけ置く。テストは app.ts を import する。
const env = loadEnv();
const app = createApp({ db: createDatabase(createPool(env.DATABASE_URL)) });

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
	console.log(`listening on ${info.address}:${info.port}`);
});

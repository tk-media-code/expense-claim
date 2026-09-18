import { Hono } from 'hono';

import type { SyncService } from '../services/sync.js';

// 04-api.md 4.3。取り込みと月度切替の検知を1本で。失敗は warnings[] に載せて 200（2.6）
export function createSyncRoute(service: SyncService) {
	return new Hono().post('/', async (c) => c.json(await service.run(new Date())));
}

import { Hono } from 'hono';

import type { SettingsService } from '../services/settings.js';

// 04-api.md 4.10。控えの書き出し・読み込み（config-backup）は 12-5 で足す
export function createSettingsRoute(service: SettingsService) {
	return new Hono().get('/', async (c) => c.json(await service.get()));
}

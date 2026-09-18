import { Hono } from 'hono';

import type { SettingsService } from '../services/settings.js';

// 04-api.md 4.10。控えの書き出し・読み込みは /api/settings/config-backup
export function createSettingsRoute(service: SettingsService) {
	return new Hono().get('/', async (c) => c.json(await service.get()));
}

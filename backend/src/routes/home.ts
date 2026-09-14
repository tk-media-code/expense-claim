import { Hono } from 'hono';

import type { HomeService } from '../services/home.js';

// 04-api.md 4.3。集約の1本目。開いた時点で必要なものが揃っていることが要件そのもの（3.1）
export function createHomeRoute(service: HomeService) {
	return new Hono().get('/', async (c) => c.json(await service.get()));
}

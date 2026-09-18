import { Hono } from 'hono';

import type { AttentionsService } from '../services/attentions.js';
import { parseIdParam } from './request.js';

// 04-api.md 4.9 の2本。要確認事項を作るエンドポイントは持たない（7章）
export function createAttentionsRoute(service: AttentionsService) {
	return (
		new Hono()
			// ?checked=false で未確認だけ。それ以外は全部
			.get('/', async (c) =>
				c.json({ attentions: await service.list(c.req.query('checked') === 'false') }),
			)
			// PATCH { checked: true } にしない。操作が1つしかなく、意味がパスに出るほうが読める
			.post('/:id/check', async (c) => c.json(await service.check(parseIdParam(c), new Date())))
	);
}

import { Hono } from 'hono';
import { z } from 'zod';

import { ROUTE_NAME_MAX_LENGTH } from '../domain/route.js';
import type { RoutesService } from '../services/routes.js';
import { parseBody, parseIdParam, readJsonBody } from './request.js';

// 入力の検証とレスポンスの組み立てだけを持つ（01-architecture.md 5.1）。
// id は正の整数。文字列の "3" は受け付けない（JSON の number で送る）
function positiveId(message: string) {
	return z.number({ error: message }).int(message).positive(message);
}

// 04-api.md 4.7。segmentIds の配列順がそのまま並び順で、sort_order はサーバーが振る（3.2）。
// 区間の並びは必須（02-screens.md 3.7）。0本のルートは記録に使えないので作らせない。
// 同じ区間を2回入れることは弾かない。設定データを機械が狭めにいかない（03-database.md 5.1）
const routeInput = z.object({
	venueId: positiveId('会場を選んでください'),
	name: z
		.string({ error: 'ルート名を入れてください' })
		.trim()
		.min(1, 'ルート名を入れてください')
		.max(ROUTE_NAME_MAX_LENGTH, `ルート名は${ROUTE_NAME_MAX_LENGTH}文字以内で入れてください`),
	segmentIds: z
		.array(positiveId('区間を選んでください'), { error: '区間を1つ以上並べてください' })
		.min(1, '区間を1つ以上並べてください'),
});

// 04-api.md 4.7 の4本。一覧は持たない。ルートは会場の一覧（GET /api/venues）に載って返る
export function createRoutesRoute(service: RoutesService) {
	return (
		new Hono()
			.post('/', async (c) => {
				const input = parseBody(routeInput, await readJsonBody(c));
				return c.json(await service.create(input), 201);
			})
			.get('/:id', async (c) => c.json(await service.get(parseIdParam(c))))
			// :id を本文より先に見る。宛先が無いものに本文の良し悪しを言っても始まらない
			.put('/:id', async (c) => {
				const id = parseIdParam(c);
				const input = parseBody(routeInput, await readJsonBody(c));
				return c.json(await service.update(id, input));
			})
			// 204。消したものを返す意味が無いので本文を持たない（04-api.md 2.3）
			.delete('/:id', async (c) => {
				await service.remove(parseIdParam(c));
				return c.body(null, 204);
			})
	);
}

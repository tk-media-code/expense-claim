import { Hono } from 'hono';
import { z } from 'zod';

import { parseTargetMonth } from '../domain/month.js';
import type { SubmissionsService } from '../services/submissions.js';
import { parseBody, readJsonBody } from './request.js';

// 04-api.md 4.8 / 6章。プレビューは GET にしない（6.3。外部 API を叩き、要確認事項を残しうる）。
// 実行の本文は targetMonth だけ（6.2）。書き込み先は受け取らない（7章）
const executeInput = z.object({
	targetMonth: z.string({ error: '対象月度を送ってください' }).transform((value, ctx) => {
		const parsed = parseTargetMonth(value);
		if (!parsed) {
			ctx.addIssue({ code: 'custom', message: '対象月度は YYYY-MM の形で送ってください' });
			return z.NEVER;
		}
		return parsed;
	}),
});

export function createSubmissionsRoute(service: SubmissionsService) {
	return new Hono()
		.post('/preview', async (c) => c.json(await service.preview(new Date())))
		.post('/', async (c) => {
			const input = parseBody(executeInput, await readJsonBody(c));
			return c.json(await service.execute(input.targetMonth, new Date()));
		});
}

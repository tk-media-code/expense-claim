import { Hono } from 'hono';
import { z } from 'zod';

import type { ExpenseRecordsService } from '../services/expense-records.js';
import { parseBody, parseIdParam, readJsonBody } from './request.js';

// 04-api.md 5.3。区間も駅名も金額も送らない。送るのは選んだルートだけである。
// このリクエストに金額が無いので、金額の妥当性はここで検査しない
function routeId(message: string) {
	return z.number({ error: message }).int(message).positive(message);
}

const saveInput = z.object({
	tripType: z.enum(['round', 'one_way'], { error: '往復か片道かを選んでください' }),
	outboundRouteId: routeId('往路ルートを選んでください'),
	returnRouteId: routeId('復路ルートを選んでください').optional(),
});

// 04-api.md 4.5 の2本。/api/projects の下に載せる。記録を消すエンドポイントは持たない
export function createExpenseRecordsRoute(service: ExpenseRecordsService) {
	return (
		new Hono()
			// 集約。案件・会場のルート・既定値・既存の記録を一式で返す（5.2）
			.get('/:id/expense-record', async (c) => c.json(await service.get(parseIdParam(c))))
			// PUT。作るのも直すのも同じ操作（4.5）。応答に保存された区間をそのまま返す（5.3）
			.put('/:id/expense-record', async (c) => {
				const id = parseIdParam(c);
				const input = parseBody(saveInput, await readJsonBody(c));
				return c.json(await service.save(id, input));
			})
	);
}

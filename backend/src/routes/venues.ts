import { Hono } from 'hono';
import { z } from 'zod';

import { VENUE_CODE_MAX_LENGTH, VENUE_NAME_MAX_LENGTH } from '../domain/venue.js';
import type { VenuesService } from '../services/venues.js';
import { parseBody, readJsonBody } from './request.js';

// 入力の検証とレスポンスの組み立てだけを持つ（01-architecture.md 5.1）。
// 前後の空白は落としてから判定する。空白だけの値は「空」として弾く。
// 会場コードの書式（英数字か）は縛らない。マスタに無いコードを足すための入口で（F-14）、
// 依頼メールに載る形をそのまま入れられなければ意味が無い
const venueInput = z.object({
	code: z
		.string({ error: '会場コードを入れてください' })
		.trim()
		.min(1, '会場コードを入れてください')
		.max(VENUE_CODE_MAX_LENGTH, `会場コードは${VENUE_CODE_MAX_LENGTH}文字以内で入れてください`),
	name: z
		.string({ error: '会場名を入れてください' })
		.trim()
		.min(1, '会場名を入れてください')
		.max(VENUE_NAME_MAX_LENGTH, `会場名は${VENUE_NAME_MAX_LENGTH}文字以内で入れてください`),
});

// 04-api.md 4.7 の一覧と追加。取り込み（POST /api/venues/import）は 8-2 で足す。
// 会場を削除するエンドポイントは持たない（7章）
export function createVenuesRoute(service: VenuesService) {
	return (
		new Hono()
			// 配列はオブジェクトで包む（04-api.md 5.1 の流儀）。順序はサーバーが決めている
			.get('/', async (c) => c.json({ venues: await service.list() }))
			.post('/', async (c) => {
				const input = parseBody(venueInput, await readJsonBody(c));
				return c.json(await service.create(input), 201);
			})
	);
}

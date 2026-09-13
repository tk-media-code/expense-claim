import { Hono } from 'hono';
import { z } from 'zod';

import { STATION_NAME_MAX_LENGTH } from '../domain/station.js';
import type { StationsService } from '../services/stations.js';
import { parseBody, readJsonBody } from './request.js';

// 入力の検証とレスポンスの組み立てだけを持つ（01-architecture.md 5.1）。
// 前後の空白は落としてから判定する。空白だけの名前は「空」として弾く。
const stationInput = z.object({
	name: z
		.string({ error: '駅名を入れてください' })
		.trim()
		.min(1, '駅名を入れてください')
		.max(STATION_NAME_MAX_LENGTH, `駅名は${STATION_NAME_MAX_LENGTH}文字以内で入れてください`),
});

// 04-api.md 4.7。PUT / DELETE は 1-4 で足す。
export function createStationsRoute(service: StationsService) {
	return (
		new Hono()
			// 配列はオブジェクトで包む（04-api.md 5.1 の流儀）。順序はサーバーが決めている
			.get('/', async (c) => c.json({ stations: await service.list() }))
			.post('/', async (c) => {
				const input = parseBody(stationInput, await readJsonBody(c));
				return c.json(await service.create(input), 201);
			})
	);
}

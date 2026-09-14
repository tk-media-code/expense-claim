import { Hono } from 'hono';
import { z } from 'zod';

import { ONE_WAY_FARE_MAX } from '../domain/segment.js';
import type { SegmentsService } from '../services/segments.js';
import { parseBody, parseIdParam, readJsonBody } from './request.js';

// 入力の検証とレスポンスの組み立てだけを持つ（01-architecture.md 5.1）。
// 駅 id は正の整数。文字列の "3" は受け付けない（JSON の number で送る）。
function stationId(label: string) {
	const message = `${label}を選んでください`;
	return z.number({ error: message }).int(message).positive(message);
}

// 04-api.md 4.7。負の運賃は 422（INVALID_VALUE）で弾く。金額が入る入口はここだけなので、
// ここで弾かなければ他に網が無い。DB の UNSIGNED / CHECK は二重の網であって一枚目ではない。
const oneWayFare = z
	.number({ error: '片道運賃を入れてください' })
	.int('片道運賃は整数で入れてください')
	.min(0, '片道運賃は0以上で入れてください')
	.max(ONE_WAY_FARE_MAX, '片道運賃が大きすぎます');

const segmentInput = z
	.object({
		fromStationId: stationId('出発駅'),
		toStationId: stationId('到着駅'),
		oneWayFare,
	})
	// path を付けるのは、parseBody が項目の文面を使うのを path のある issue に限っているため
	.refine((input) => input.fromStationId !== input.toStationId, {
		message: '出発駅と到着駅は別の駅にしてください',
		path: ['toStationId'],
	});

// PUT は駅が任意。片方だけでも受け、同一駅かどうかは現在値と合わせて services が見る。
// 使っているルートがあるときに駅を送れば 409（4.7）。それも services が routeCount で決める
const segmentUpdateInput = z.object({
	fromStationId: stationId('出発駅').optional(),
	toStationId: stationId('到着駅').optional(),
	oneWayFare,
});

// 04-api.md 4.7 の4本。
export function createSegmentsRoute(service: SegmentsService) {
	return (
		new Hono()
			// 配列はオブジェクトで包む（04-api.md 5.1 の流儀）。順序はサーバーが決めている
			.get('/', async (c) => c.json({ segments: await service.list() }))
			.post('/', async (c) => {
				const input = parseBody(segmentInput, await readJsonBody(c));
				return c.json(await service.create(input), 201);
			})
			// :id を本文より先に見る。宛先が無いものに本文の良し悪しを言っても始まらない
			.put('/:id', async (c) => {
				const id = parseIdParam(c);
				const input = parseBody(segmentUpdateInput, await readJsonBody(c));
				return c.json(await service.update(id, input));
			})
			// 204。消したものを返す意味が無いので本文を持たない（04-api.md 2.3）
			.delete('/:id', async (c) => {
				await service.remove(parseIdParam(c));
				return c.body(null, 204);
			})
	);
}

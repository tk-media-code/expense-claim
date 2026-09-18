import { Hono } from 'hono';
import { z } from 'zod';

import { todayInJst } from '../domain/month.js';
import { ROUTE_NAME_MAX_LENGTH } from '../domain/route.js';
import { ONE_WAY_FARE_MAX } from '../domain/segment.js';
import { STATION_NAME_MAX_LENGTH } from '../domain/station.js';
import { VENUE_CODE_MAX_LENGTH, VENUE_NAME_MAX_LENGTH } from '../domain/venue.js';
import type { ConfigBackupService } from '../services/config-backup.js';
import { parseBody, readJsonBody } from './request.js';

// 04-api.md 4.10。GET は JSON をファイルとして返し、POST は同じ形を受けて置き換える
const name = (label: string, max: number) =>
	z
		.string({ error: `${label}を入れてください` })
		.trim()
		.min(1, `${label}を入れてください`)
		.max(max, `${label}は${max}文字以内で入れてください`);

const stationName = (label: string) => name(label, STATION_NAME_MAX_LENGTH);

const backupInput = z.object({
	version: z.literal(1, {
		error: '控えの version が違います。このアプリが書き出したものを選んでください',
	}),
	stations: z.array(z.object({ name: stationName('駅名') })),
	venues: z.array(
		z.object({
			code: name('会場コード', VENUE_CODE_MAX_LENGTH),
			name: name('会場名', VENUE_NAME_MAX_LENGTH),
			source: z.enum(['master', 'manual'], { error: '会場の出どころが正しくありません' }),
		}),
	),
	segments: z.array(
		z.object({
			fromStation: stationName('出発駅'),
			toStation: stationName('到着駅'),
			oneWayFare: z
				.number({ error: '片道運賃を入れてください' })
				.int('片道運賃は整数で入れてください')
				.min(0, '片道運賃は0以上で入れてください')
				.max(ONE_WAY_FARE_MAX, '片道運賃が大きすぎます'),
		}),
	),
	routes: z.array(
		z.object({
			venueCode: name('会場コード', VENUE_CODE_MAX_LENGTH),
			name: name('ルート名', ROUTE_NAME_MAX_LENGTH),
			segments: z.array(
				z.object({ fromStation: stationName('出発駅'), toStation: stationName('到着駅') }),
			),
		}),
	),
});

export function createConfigBackupRoute(service: ConfigBackupService) {
	return new Hono()
		.get('/', async (c) => {
			const now = new Date();
			const backup = await service.exportBackup(now);
			// ブラウザがダウンロードとして扱う。名前に日付を入れ、控えが並んでも見分けられるようにする
			const stamp = todayInJst(now).replace(/-/g, '');
			c.header('content-disposition', `attachment; filename="expense-claim-config-${stamp}.json"`);
			return c.json(backup);
		})
		.post('/', async (c) => {
			const input = parseBody(backupInput, await readJsonBody(c));
			return c.json(await service.importBackup(input));
		});
}

import { Hono } from 'hono';
import { z } from 'zod';

import { parseCalendarDate } from '../domain/month.js';
import { COUPLE_NAME_MAX_LENGTH, PROJECT_NO_MAX_LENGTH } from '../domain/project.js';
import { VENUE_CODE_MAX_LENGTH } from '../domain/venue.js';
import type { ProjectsService } from '../services/projects.js';
import { parseBody, parseIdParam, readJsonBody } from './request.js';

// 入力の検証とレスポンスの組み立てだけを持つ（01-architecture.md 5.1）。
// 前後の空白は落としてから判定する。空白だけの値は「空」として弾く。
const projectNo = z
	.string({ error: '案件番号を入れてください' })
	.trim()
	.min(1, '案件番号を入れてください')
	.max(PROJECT_NO_MAX_LENGTH, `案件番号は${PROJECT_NO_MAX_LENGTH}文字以内で入れてください`);

// 施行日は YYYY-MM-DD の暦日（04-api.md 2.4）。時刻もタイムゾーンも付けない。
// transform で CalendarDate の型にし、services から先は素の文字列を見ない
const serviceDate = z.string({ error: '施行日を入れてください' }).transform((value, ctx) => {
	const parsed = parseCalendarDate(value);
	if (!parsed) {
		ctx.addIssue({ code: 'custom', message: '施行日は YYYY-MM-DD の形で入れてください' });
		return z.NEVER;
	}
	return parsed;
});

const venueCode = z
	.string({ error: '会場を選んでください' })
	.trim()
	.min(1, '会場を選んでください')
	.max(VENUE_CODE_MAX_LENGTH, `会場コードは${VENUE_CODE_MAX_LENGTH}文字以内で入れてください`);

const coupleName = z
	.string({ error: 'ご両家名を入れてください' })
	.trim()
	.min(1, 'ご両家名を入れてください')
	.max(COUPLE_NAME_MAX_LENGTH, `ご両家名は${COUPLE_NAME_MAX_LENGTH}文字以内で入れてください`);

// 04-api.md 4.4。source は受け取らない（7章）。送られても無視する
const projectCreateInput = z.object({ projectNo, serviceDate, venueCode, coupleName });

// PATCH はどの項目も任意。空のオブジェクトは何も変えずに現在値を返す
const projectUpdateInput = z.object({
	projectNo: projectNo.optional(),
	serviceDate: serviceDate.optional(),
	venueCode: venueCode.optional(),
	coupleName: coupleName.optional(),
});

// 04-api.md 4.4 の4本。一覧は持たない。案件は GET /api/home が月度ごとに束ねて返す（4.3）
export function createProjectsRoute(service: ProjectsService) {
	return (
		new Hono()
			.post('/', async (c) => {
				const input = parseBody(projectCreateInput, await readJsonBody(c));
				return c.json(await service.create(input), 201);
			})
			.get('/:id', async (c) => c.json(await service.get(parseIdParam(c))))
			// :id を本文より先に見る。宛先が無いものに本文の良し悪しを言っても始まらない
			.patch('/:id', async (c) => {
				const id = parseIdParam(c);
				const input = parseBody(projectUpdateInput, await readJsonBody(c));
				return c.json(await service.update(id, input));
			})
			// 204。消したものを返す意味が無いので本文を持たない（04-api.md 2.3）
			.delete('/:id', async (c) => {
				await service.remove(parseIdParam(c));
				return c.body(null, 204);
			})
	);
}

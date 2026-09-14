import type { Context } from 'hono';
import type { ZodType } from 'zod';

import { AppError } from '../domain/app-error.js';

// リクエスト本文の読み方をここに1つ持つ。POST / PUT のルートはすべてこれを通る。
//
// Hono の validator / @hono/zod-validator を使わない。壊れた JSON を text/plain の 400 で
// 返してしまい、04-api.md 2.5 の形を通らない。env.ts と同じく zod の safeParse を手で呼ぶ。

// 本文が JSON として壊れていれば 400（04-api.md 2.5）。
// c.req.json() の SyntaxError をそのまま流すと、想定外の例外として 500 になる。
export async function readJsonBody(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch (cause) {
		throw new AppError('BAD_REQUEST', { cause });
	}
}

// 値が規則に合わなければ 422（04-api.md 2.5）。
// 項目ごとの文面はスキーマに書く。1文では本人が何を直せばよいか分からないからである（2.5）。
// 本文の形そのものが違う（オブジェクトでない）ときは項目が無いので、既定の文面に落とす。
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
	const parsed = schema.safeParse(body);
	if (parsed.success) return parsed.data;
	const issue = parsed.error.issues[0];
	const message = issue && issue.path.length > 0 ? issue.message : undefined;
	throw new AppError('INVALID_VALUE', { message, cause: parsed.error });
}

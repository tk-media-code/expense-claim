import { z } from 'zod';

// 設定はすべて環境変数から取る（01-architecture.md 6.1 の縛り3 / NF-07）。
// クラウド固有のシークレット機構を挟まない。
const envSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3000),
	DATABASE_URL: z.string().min(1, 'DATABASE_URL が空です'),
});

export type Env = z.infer<typeof envSchema>;

// 起動時に落とす。足りない設定を抱えたまま動き出すと、
// 最初のリクエストまで気づけない。
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const parsed = envSchema.safeParse(source);
	if (!parsed.success) {
		const detail = parsed.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('\n  ');
		throw new Error(`環境変数が正しくありません。\n  ${detail}`);
	}
	return parsed.data;
}

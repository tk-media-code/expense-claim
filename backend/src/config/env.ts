import { z } from 'zod';

// 設定はすべて環境変数から取る（01-architecture.md 6.1 の縛り3 / NF-07）。
// クラウド固有のシークレット機構を挟まない。一覧は 05-integration.md 9章。
const envSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3000),
	DATABASE_URL: z.string().min(1, 'DATABASE_URL が空です'),
	// セッション Cookie の署名鍵（01-architecture.md 7.3）。短いと総当たりで署名を作れる
	SESSION_SECRET: z.string().min(16, 'SESSION_SECRET は16文字以上にしてください'),
	// 許可するメールアドレス（05-integration.md 3.5 / N-18）
	ALLOWED_EMAIL: z.string().min(1, 'ALLOWED_EMAIL が空です'),
	// OAuth クライアント（05-integration.md 3章）。空なら Google のログインと認可は使えない（開発では E2E が Cookie を直接載せる）
	GOOGLE_CLIENT_ID: z.string().default(''),
	GOOGLE_CLIENT_SECRET: z.string().default(''),
	GOOGLE_REDIRECT_URI_LOGIN: z.string().default(''),
	GOOGLE_REDIRECT_URI_AUTHORIZATION: z.string().default(''),
	// リフレッシュトークンの暗号鍵（01-architecture.md 7.2）。漏れるとトークンと同じ危険度
	TOKEN_ENCRYPTION_KEY: z.string().min(16, 'TOKEN_ENCRYPTION_KEY は16文字以上にしてください'),
	// Google を叩かない開発用の実装に差し替える（integrations/stub）。E2E と OAuth クライアントを持たない
	// 開発環境のためのもので、本番の compose.yaml は渡さない
	GOOGLE_STUB: z
		.string()
		.default('')
		.transform((value) => value === '1' || value === 'true'),
	// 提出シート・領収書・メール（05-integration.md 9章）。空なら、その連携だけが使えない
	SPREADSHEET_ID: z.string().default(''),
	MY_SHEET_NAME: z.string().default(''),
	DRIVE_FOLDER_ID: z.string().default(''),
	GMAIL_SENDER: z.string().default(''),
	ALERT_TO: z.string().default(''),
	// 提出アラートに載せるアプリの URL（要件定義 4.10）。空なら載せない
	APP_URL: z.string().default(''),
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

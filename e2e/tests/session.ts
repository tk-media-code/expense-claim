import { createHmac } from 'node:crypto';

// /api/* に認証が被さる（NF-06）。E2E は Google の同意画面を通れないので、backend と同じ形の
// セッション Cookie（backend/src/routes/session-cookie.ts）を、開発用の鍵で自分で署名して載せる。
// 鍵は compose.override.yaml の既定値。本番の鍵を知らなければ作れないので、認証の穴にはならない。
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-session-secret-change-me';

export function sessionToken(sub = 'e2e', iat = Math.floor(Date.now() / 1000)): string {
	const payload = Buffer.from(JSON.stringify({ sub, iat })).toString('base64url');
	const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
	return `${payload}.${signature}`;
}

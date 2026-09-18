import type { MiddlewareHandler } from 'hono';

import { AppError } from '../domain/app-error.js';
import type { AuthService } from '../services/auth.js';
import { readSessionToken, setSessionCookie, verifySessionToken } from './session-cookie.js';

// /api/* に認証を被せる（NF-06 / 04-api.md 4.1）。
// 除くのは /api/health（4.11）と、ログインの入口そのもの（/api/auth/login と /api/auth/callback）。
// 後者は設計書に明記が無いが、ログイン前に叩くものなので被せようがない。
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/callback']);

// CSRF は Origin の照合だけ（04-api.md 2.2）。Cookie が SameSite=Lax なので、クロスサイトからの
// POST にはそもそも付かない。Origin が付いていて自分のホストと違えば 403。付いていなければ
// ブラウザ以外（テスト・curl）なので通す。
// 比べるのはホスト名だけで、ポートは見ない。Cookie はポートで分かれないので、ポートが違っても
// 同じ Cookie が付く。nginx が渡す Host（$host）にもポートが無い
function hostnameOf(value: string): string | null {
	try {
		return new URL(value.includes('://') ? value : `http://${value}`).hostname;
	} catch {
		return null;
	}
}

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
	if (!origin) return true;
	if (!host) return false;
	const expected = hostnameOf(host);
	return expected !== null && hostnameOf(origin) === expected;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const NO_RENEW_PATHS = new Set(['/api/auth/logout', '/api/auth/logout-all']);

export function requireSession(service: AuthService, sessionSecret: string): MiddlewareHandler {
	return async (c, next) => {
		if (PUBLIC_PATHS.has(c.req.path)) return next();

		if (STATE_CHANGING.has(c.req.method)) {
			const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
			if (!originAllowed(c.req.header('origin'), host)) throw new AppError('NOT_ALLOWED');
		}

		// 04-api.md 4.1 の順序。1 署名 → 2 失効 → 3 期限 → 4 発行し直し
		const token = readSessionToken(c);
		const session = token ? await verifySessionToken(sessionSecret, token) : null;
		if (!session) throw new AppError('UNAUTHENTICATED');
		const now = new Date();
		if (!(await service.verifySession(session, now))) throw new AppError('UNAUTHENTICATED');
		// 使うたび延びる（01-architecture.md 3.7）。ログアウトは Cookie を消す側なので発行し直さない。
		// 同じ名前の Set-Cookie を2つ返さない
		if (!NO_RENEW_PATHS.has(c.req.path)) {
			await setSessionCookie(c, sessionSecret, {
				sub: session.sub,
				iat: Math.floor(now.getTime() / 1000),
			});
		}
		return next();
	};
}

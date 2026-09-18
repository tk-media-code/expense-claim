import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { SESSION_TTL_SECONDS, type Session } from '../domain/session.js';

// セッション Cookie の読み書き（04-api.md 2.3 / 4.1）。HTTP の関心なので routes に置く。
//
// 署名は HMAC-SHA256。形は `<base64url(JSON)>.<base64url(HMAC)>` で、Hono の署名付き Cookie の
// 内部形式に寄りかからない。E2E が同じ形の Cookie を自分で作って載せるため（e2e/tests/session.ts）。
// Web Crypto を使うのは、Node.js でも Workers でも同じ API だから（01-architecture.md 6章）。

export const SESSION_COOKIE = 'session';

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
	return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
		'base64url',
	);
}

async function hmac(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export async function signSession(secret: string, session: Session): Promise<string> {
	const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
	return `${payload}.${await hmac(secret, payload)}`;
}

/** 署名が合えば中身を返す。合わなければ・形が違えば null */
export async function verifySessionToken(secret: string, token: string): Promise<Session | null> {
	const [payload, signature, ...rest] = token.split('.');
	if (!payload || !signature || rest.length > 0) return null;
	const expected = await hmac(secret, payload);
	// 長さが違えば timingSafeEqual が投げるので先に見る。長さの一致だけでは何も漏れない
	if (expected.length !== signature.length) return null;
	const a = encoder.encode(expected);
	const b = encoder.encode(signature);
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	if (diff !== 0) return null;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			!('sub' in parsed) ||
			!('iat' in parsed) ||
			typeof parsed.sub !== 'string' ||
			typeof parsed.iat !== 'number'
		) {
			return null;
		}
		return { sub: parsed.sub, iat: parsed.iat };
	} catch {
		return null;
	}
}

// Secure は HTTPS のときだけ付ける。nginx が X-Forwarded-Proto を渡す（nginx/*.conf）。
// 開発（http://localhost）で Secure を付けると、ブラウザが Cookie を捨てる
function isHttps(c: Context): boolean {
	return c.req.header('x-forwarded-proto') === 'https';
}

export async function setSessionCookie(
	c: Context,
	secret: string,
	session: Session,
): Promise<void> {
	setCookie(c, SESSION_COOKIE, await signSession(secret, session), {
		httpOnly: true,
		sameSite: 'Lax',
		secure: isHttps(c),
		path: '/',
		maxAge: SESSION_TTL_SECONDS,
	});
}

export function clearSessionCookie(c: Context): void {
	deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function readSessionToken(c: Context): string | undefined {
	return getCookie(c, SESSION_COOKIE);
}

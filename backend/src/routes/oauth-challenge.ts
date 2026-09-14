import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

// OAuth の state・nonce・PKCE の verifier を、署名付きの短命 Cookie に置く（05-integration.md 3.4）。
// ログイン（/api/auth）と Google API の認可（/api/google/authorization）の両方が使う。
// SameSite=Lax の Cookie はトップレベルの GET には付くので、コールバックだけは state の素の照合が要る（04-api.md 2.2）

export type OAuthChallenge = { state: string; nonce: string; codeVerifier: string };

const MAX_AGE = 10 * 60;

function base64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64url');
}

function random(bytes: number): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmac(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return base64url(
		new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))),
	);
}

export function newChallenge(): OAuthChallenge {
	return { state: random(32), nonce: random(32), codeVerifier: random(48) };
}

// PKCE（S256）。コンフィデンシャルクライアントにも使う。実装が数行で済み、塞げるものは塞ぐ（3.4）
export async function codeChallengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

/** 中身は乱数だけで秘密ではないが、書き換えられないよう署名しておく。path で入口ごとに分ける */
export async function setChallengeCookie(
	c: Context,
	name: string,
	path: string,
	secret: string,
	challenge: OAuthChallenge,
): Promise<void> {
	const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url');
	setCookie(c, name, `${payload}.${await hmac(secret, payload)}`, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: c.req.header('x-forwarded-proto') === 'https',
		path,
		maxAge: MAX_AGE,
	});
}

/** 読んだら消す。署名が合わなければ null */
export async function takeChallengeCookie(
	c: Context,
	name: string,
	path: string,
	secret: string,
): Promise<OAuthChallenge | null> {
	const raw = getCookie(c, name);
	deleteCookie(c, name, { path });
	if (!raw) return null;
	const [payload, signature] = raw.split('.');
	if (!payload || !signature) return null;
	if ((await hmac(secret, payload)) !== signature) return null;
	try {
		const parsed = JSON.parse(
			Buffer.from(payload, 'base64url').toString('utf8'),
		) as Partial<OAuthChallenge>;
		if (!parsed.state || !parsed.nonce || !parsed.codeVerifier) return null;
		return { state: parsed.state, nonce: parsed.nonce, codeVerifier: parsed.codeVerifier };
	} catch {
		return null;
	}
}

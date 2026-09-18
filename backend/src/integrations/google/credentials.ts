// リフレッシュトークンの暗号化（01-architecture.md 7.2 / 03-database.md 5.3）。
// AES-256-GCM。鍵は環境変数 TOKEN_ENCRYPTION_KEY から SHA-256 で 32 バイトに整える。
// Web Crypto を使い、Node.js でも Workers でも同じ API で動く。
// 保存する形は iv(12) + 暗号文 + タグ(16) を連結したバイト列で、VARBINARY(1024) に収まる。

const IV_LENGTH = 12;

async function keyOf(secret: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(secret: string, plain: string): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await keyOf(secret);
	const encrypted = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
	);
	const out = new Uint8Array(iv.length + encrypted.length);
	out.set(iv, 0);
	out.set(encrypted, iv.length);
	return out;
}

/** 鍵が違う・改ざんされている・形が違うなら null。呼び出し側は「認可が無い」として再認可へ導く */
export async function decryptToken(secret: string, stored: Uint8Array): Promise<string | null> {
	if (stored.length <= IV_LENGTH) return null;
	try {
		const key = await keyOf(secret);
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: stored.slice(0, IV_LENGTH) },
			key,
			stored.slice(IV_LENGTH),
		);
		return new TextDecoder().decode(plain);
	} catch {
		return null;
	}
}

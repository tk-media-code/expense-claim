// Gmail API の payload を読むための小道具。tools/gmail-probe/mail-util.cjs の移植。
// I/O を持たない。payload の形（要求分析 6.2・実測）だけを知る

export type MailPart = {
	mimeType?: string | null;
	headers?: { name?: string | null; value?: string | null }[] | null;
	body?: { data?: string | null } | null;
	parts?: MailPart[] | null;
};

/** ヘッダ名の大小は送信側まかせなので、必ず小文字にそろえて引く */
export function headerOf(
	headers: { name?: string | null; value?: string | null }[] | null | undefined,
	name: string,
): string | null {
	const key = name.toLowerCase();
	const hit = (headers ?? []).find((h) => String(h.name ?? '').toLowerCase() === key);
	return hit?.value ?? null;
}

/** payload を深さ優先でたどって平らにする */
export function walkParts(payload: MailPart | null | undefined): MailPart[] {
	if (!payload) return [];
	return [payload, ...(payload.parts ?? []).flatMap((part) => walkParts(part))];
}

function charsetOf(part: MailPart): string {
	const contentType = headerOf(part.headers, 'content-type') ?? '';
	const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
	return m?.[1]?.toLowerCase() ?? 'utf-8';
}

/**
 * body.data は base64url。転送エンコーディングは Gmail 側で解けた状態で来るので、
 * ここで戻すのはそのパートの charset における生バイト列。日本語メールは ISO-2022-JP のことがあり、
 * 解けなかったときに黙って化けさせず utf-8 に倒す
 */
export function decodeBody(part: MailPart | null): string {
	const data = part?.body?.data;
	if (!part || !data) return '';
	const bytes = Buffer.from(data, 'base64url');
	try {
		return new TextDecoder(charsetOf(part), { fatal: false }).decode(bytes);
	} catch {
		return bytes.toString('utf8');
	}
}

export function findPart(payload: MailPart | null | undefined, mimeType: string): MailPart | null {
	return walkParts(payload).find((part) => part.mimeType === mimeType && part.body?.data) ?? null;
}

const ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	yen: '¥',
};

function decodeEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
		.replace(
			/&([a-z]+);/gi,
			(match: string, name: string) => ENTITIES[name.toLowerCase()] ?? match,
		);
}

/**
 * HTML を、行と列の区切りを保ったままテキストにする。依頼メールは表で組まれているため、
 * セルの境目を落とすと項目名と値がくっついて読めなくなる。td はタブ、tr と br は改行に置き換える
 */
export function htmlToText(html: string): string {
	if (!html) return '';
	return decodeEntities(
		html
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
			.replace(/<\s*br\s*\/?\s*>/gi, '\n')
			.replace(/<\s*\/\s*(td|th)\s*>/gi, '\t')
			.replace(/<\s*\/\s*(tr|p|div|h[1-6]|li|table)\s*>/gi, '\n')
			.replace(/<[^>]+>/g, ''),
	)
		.replace(/\r\n?/g, '\n')
		.replace(/[ 　]+/g, ' ')
		.replace(/[ \t]*\n[ \t]*/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

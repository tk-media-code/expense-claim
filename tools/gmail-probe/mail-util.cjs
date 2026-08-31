// Gmail API の戻り値を読むための小道具。
//
// 端末に実データを出さないことが、このファイルのいちばんの仕事になっている。
// 依頼メールにはご両家名・会場名・緊急連絡先・他スタッフの氏名が入っており、
// 要求分析 1章が「この文書には構造と仕様だけを書き、実データは書かない」と定めている。
// 端末の出力はコミットメッセージや PR へ引き写される経路があるため、伏せるのは
// ファイル出力ではなく端末側にする（全文は out/ に残す。out/ は Git 管理外）。
//
// 伏せ字には値ごとに安定した短いハッシュを添える。ただ <氏名> と潰すと
// 「2通の差出人が同じか」「同じ会場が2回出たか」が端末から読めなくなり、
// 検証の役に立たないため。ハッシュが同じなら元の値も同じ、とだけ分かればよい。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../sheet-probe/auth.cjs');

const OUT_DIR = path.join(__dirname, 'out');

// --- 出力 -------------------------------------------------------------------

function saveOut(name, data) {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const file = path.join(OUT_DIR, name);
	fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
	return path.relative(REPO_ROOT, file);
}

// API のエラーを、原因が分かる形に潰す。sheet-probe と同じ形にそろえてある。
function describeError(err) {
	const e = err?.response?.data?.error;
	if (e) return { status: err.response.status, code: e.code, message: e.message, statusText: e.status };
	return { status: err?.code ?? null, message: err?.message ?? String(err) };
}

// --- 伏せ字 -----------------------------------------------------------------

function tag(value) {
	return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 4);
}

// <種別#ハッシュ 長さ> の形にする。長さを出すのは、抽出できた値が空でないこと、
// 会場コードなら3文字前後であることを、実値を見ずに確かめるため。
function mask(kind, value) {
	if (value == null || value === '') return `<${kind}: 空>`;
	const s = String(value);
	return `<${kind}#${tag(s)} ${[...s].length}文字>`;
}

// 宛先ヘッダは1件とは限らない。実物の To には2名が入っており、しかも依頼無しの
// メールでは自分が To に居ない（Bcc で届いている）。1件だけ見る実装だと、
// 最後の1件を全体の宛先として報告してしまうので、必ず分解してから伏せる。
//
// 引用符の中のカンマは区切りではない。表示名に「姓, 名」を使う相手が居ると、
// 単純な split(',') は1件を2件に割ってしまう。
function splitAddressList(raw) {
	const out = [];
	let buf = '';
	let quoted = false;
	for (const ch of String(raw)) {
		if (ch === '"') quoted = !quoted;
		if (ch === ',' && !quoted) {
			out.push(buf);
			buf = '';
			continue;
		}
		buf += ch;
	}
	out.push(buf);
	return out.map((s) => s.trim()).filter(Boolean);
}

// "表示名 <アドレス>" の1件を、表示名とアドレスに分けて伏せる。
function maskOneAddress(one) {
	const m = String(one).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
	if (!m) return mask('アドレス', String(one).trim());
	const [, display, addr] = m;
	const parts = [mask('アドレス', addr)];
	if (display) parts.unshift(mask('表示名', display.replace(/^"|"$/g, '')));
	return parts.join(' ');
}

function maskAddressHeader(raw) {
	if (!raw) return '(無し)';
	const list = splitAddressList(raw);
	const body = list.map(maskOneAddress).join(' , ');
	return list.length > 1 ? `${list.length}件: ${body}` : body;
}

// --- ヘッダ -----------------------------------------------------------------

// ヘッダ名の大小は送信側まかせなので、必ず小文字にそろえて引く。
function header(headers, name) {
	const key = name.toLowerCase();
	const hit = (headers || []).find((h) => String(h.name).toLowerCase() === key);
	return hit ? hit.value : null;
}

function allHeaders(headers, name) {
	const key = name.toLowerCase();
	return (headers || []).filter((h) => String(h.name).toLowerCase() === key).map((h) => h.value);
}

// --- MIME -------------------------------------------------------------------

// payload を深さ優先でたどって平らにする。各パートに親からの経路を持たせる。
function walkParts(payload, trail = []) {
	if (!payload) return [];
	const here = { ...payload, trail: [...trail], depth: trail.length };
	const kids = payload.parts || [];
	return [here, ...kids.flatMap((p, i) => walkParts(p, [...trail, i]))];
}

function mimeTree(payload) {
	return walkParts(payload).map((p) => ({
		path: p.trail.length ? p.trail.join('.') : '(root)',
		mimeType: p.mimeType,
		filename: p.filename || '',
		size: p.body?.size ?? 0,
		hasData: Boolean(p.body?.data),
		attachmentId: p.body?.attachmentId ?? null,
		charset: charsetOf(p),
	}));
}

function charsetOf(part) {
	const ct = header(part.headers, 'content-type') || '';
	const m = ct.match(/charset\s*=\s*"?([^";\s]+)"?/i);
	return m ? m[1].toLowerCase() : null;
}

// body.data は base64url。転送エンコーディングは Gmail 側で解けた状態で来るので、
// ここで戻すのは「そのパートの charset における生バイト列」になる。
function decodeBody(part) {
	const data = part?.body?.data;
	if (!data) return { text: null, charset: null, decodedBy: null };
	const buf = Buffer.from(data, 'base64url');
	const charset = charsetOf(part) || 'utf-8';
	// 日本語メールは ISO-2022-JP のことがある。Node は full-icu を同梱しているので
	// TextDecoder で解けるはずだが、解けなかったときに黙って化けさせない。
	try {
		return { text: new TextDecoder(charset, { fatal: false }).decode(buf), charset, decodedBy: 'TextDecoder' };
	} catch {
		return { text: buf.toString('utf8'), charset, decodedBy: 'utf8フォールバック' };
	}
}

function findPart(payload, mimeType) {
	return walkParts(payload).find((p) => p.mimeType === mimeType && p.body?.data) || null;
}

// --- HTML -------------------------------------------------------------------

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", yen: '¥' };

function decodeEntities(s) {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// HTML を、行と列の区切りを保ったままテキストにする。
// 依頼メールは表で組まれているため、セルの境目を落とすと項目名と値がくっついて
// 読めなくなる。td はタブ、tr と br は改行に置き換える。
function htmlToText(html) {
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

module.exports = {
	OUT_DIR,
	saveOut,
	describeError,
	tag,
	mask,
	maskAddressHeader,
	splitAddressList,
	header,
	allHeaders,
	walkParts,
	mimeTree,
	charsetOf,
	decodeBody,
	findPart,
	decodeEntities,
	htmlToText,
};

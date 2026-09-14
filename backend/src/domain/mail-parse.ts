import { calendarDateOf, type CalendarDate } from './month.js';

// 依頼メールから項目を取り出す規則（05-integration.md 4.3 / 要件定義 7.2）。
// tools/gmail-probe/extract.cjs の移植。実測で何度も直して辿り着いたもので、書き直さない。
// 落としたもの: リンク（叩かない）・スタッフの割当（他人の氏名を持たない）・時刻・緊急連絡先。
//
// 置き場が domain なのは、I/O を持たず、入力は文字列・出力は案件か失敗で、架空の文字列でテストできるため。
// 委託元のメール書式の話であって Gmail の都合ではない（相手が Gmail をやめても規則は変わらない）。

const DATE = String.raw`\d{4}\/\d{1,2}\/\d{1,2}`;
const FAMILY_PAIR = /^(\S+様)[ 　\t]+(\S+様)$/;
const VENUE_CODE = /^[0-9A-Za-z]{1,5}$/;

export type MailKind = 'project' | 'no_request' | 'unknown';

/** 件名で種別を判別する（F-05 / R-19）。書式は文書どおり厳密に一致した（要求分析 6章・実測） */
export function classifySubject(subject: string): MailKind {
	if (new RegExp(`^${DATE}案件詳細です。$`).test(subject)) return 'project';
	if (/^【\d{1,2}月\d{1,2}日\(.\)\s*依頼無しのご連絡】$/.test(subject)) return 'no_request';
	return 'unknown';
}

export type ParsedProject = {
	serviceDate: CalendarDate;
	venueCode: string;
	venueName: string;
	/** `〇〇様△△様` の形（要件定義 5.3 の D列）。メールでは間に空白がある */
	coupleName: string;
	projectNo: string;
};

export type ParsedMail =
	| { kind: 'project'; project: ParsedProject }
	| { kind: 'no_request' }
	/** 裏取りが通らなかった（F-07）。取り出せなかった項目名を持つ（06-error-handling.md 4.2） */
	| { kind: 'parse_failed'; missing: string[] };

function pick(text: string, re: RegExp): string | null {
	const m = re.exec(text);
	return m?.[1] ? m[1].trim() : null;
}

/** `2026/9/5` → 暦日。ゼロ埋めは無い（要求分析 6.3） */
export function calendarDateOfSlashed(value: string): CalendarDate | null {
	const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
	if (!m) return null;
	return calendarDateOf(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * 案件詳細メールの平文から5項目を取り出す（F-06）。
 * 先頭の4行には見出しが無く位置で読むしかないので、1行目の日付が「施行日」行の日付と一致し、
 * 4行目が `〇〇様 △△様` の形であることを確かめてから、2行目を会場名・3行目を会場コードとして採る（F-07 / N-16）。
 * どちらかが崩れたら値を採らない。書式が変われば裏取りが失敗する。それでよい
 */
export function parseRequestMail(subject: string, plainBody: string): ParsedMail {
	const kind = classifySubject(subject);
	if (kind === 'no_request') return { kind: 'no_request' };
	if (kind === 'unknown') return { kind: 'parse_failed', missing: ['件名'] };

	const text = plainBody.replace(/\r\n?/g, '\n');
	const head = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.slice(0, 4);

	const serviceDateText = pick(text, new RegExp(`^施行日[ 　\\t]*(${DATE})`, 'm'));
	const serviceDate = serviceDateText ? calendarDateOfSlashed(serviceDateText) : null;
	const pair = head[3] ? FAMILY_PAIR.exec(head[3]) : null;
	const headTrusted = serviceDateText !== null && head[0] === serviceDateText && pair !== null;
	const projectNo = pick(text, /^案件番号[ 　\t]*[:：][ 　\t]*(\d+)/m);
	const venueName = headTrusted ? (head[1] ?? null) : null;
	const venueCode = headTrusted && head[2] && VENUE_CODE.test(head[2]) ? head[2] : null;
	const coupleName = pair ? `${pair[1]}${pair[2]}` : null;

	const missing: string[] = [];
	if (!serviceDate) missing.push('施行日');
	if (!venueName) missing.push('会場名');
	if (!venueCode) missing.push('会場コード');
	if (!coupleName || !headTrusted) missing.push('ご両家名');
	if (!projectNo) missing.push('案件番号');
	if (missing.length > 0 || !serviceDate || !venueName || !venueCode || !coupleName || !projectNo) {
		return { kind: 'parse_failed', missing };
	}
	return { kind: 'project', project: { serviceDate, venueCode, venueName, coupleName, projectNo } };
}

import { describe, expect, it } from 'vitest';

import { decodeBody, findPart, headerOf, htmlToText, walkParts, type MailPart } from './mime.js';

// 要求分析 6.2・実測。最上位は multipart/alternative、平文と HTML の2パート、UTF-8、添付は無い
const plain = Buffer.from('2026/9/5\n甲ホール\n', 'utf8').toString('base64url');
const html = Buffer.from(
	'<table><tr><td>施行日</td><td>2026/9/5</td></tr></table><p>&amp;</p>',
	'utf8',
).toString('base64url');
const payload: MailPart = {
	mimeType: 'multipart/alternative',
	headers: [{ name: 'Subject', value: '2026/9/5案件詳細です。' }],
	parts: [
		{
			mimeType: 'text/plain',
			headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
			body: { data: plain },
		},
		{
			mimeType: 'text/html',
			headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }],
			body: { data: html },
		},
	],
};

describe('mime', () => {
	it('ヘッダ名の大小を区別せずに引く', () => {
		expect(headerOf(payload.headers, 'subject')).toBe('2026/9/5案件詳細です。');
		expect(headerOf(payload.headers, 'from')).toBeNull();
	});

	it('パートを平らにし、種別で探す', () => {
		expect(walkParts(payload)).toHaveLength(3);
		expect(findPart(payload, 'text/plain')?.mimeType).toBe('text/plain');
		expect(findPart(payload, 'image/png')).toBeNull();
	});

	it('base64url の本文を charset で解く', () => {
		expect(decodeBody(findPart(payload, 'text/plain'))).toBe('2026/9/5\n甲ホール\n');
		expect(decodeBody(null)).toBe('');
	});

	// 依頼メールは表で組まれている。td はタブ、tr は改行
	it('HTML を、セルの境目を保ったままテキストにする', () => {
		// tr と table の閉じで改行が2つ入る。3つ以上は2つに畳む
		expect(htmlToText(decodeBody(findPart(payload, 'text/html')))).toBe('施行日\t2026/9/5\n\n&');
	});
});

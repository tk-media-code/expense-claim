import { describe, expect, it } from 'vitest';

import { calendarDateOfSlashed, classifySubject, parseRequestMail } from './mail-parse.js';

// 依頼メールの書式（要求分析 6.3）に合わせた架空の本文。実データは書かない（公開リポジトリ）。
// 先頭4行に見出しが無く、そのあとに見出し付きの項目が並ぶ
const body = [
	'2026/9/5',
	'甲ホール',
	'AAA',
	'〇〇様 △△様',
	'',
	'施行日 2026/9/5',
	'挙式 11:00',
	'披露宴 12:30',
	'案件番号：100000001',
	'',
	'案件承諾',
	'<https://example.test/accept/abc>',
].join('\n');

describe('classifySubject', () => {
	it('案件詳細と依頼無しを件名で見分ける（F-05）', () => {
		expect(classifySubject('2026/9/5案件詳細です。')).toBe('project');
		expect(classifySubject('【9月5日(土) 依頼無しのご連絡】')).toBe('no_request');
		expect(classifySubject('Re: 2026/9/5案件詳細です。')).toBe('unknown');
	});
});

describe('calendarDateOfSlashed', () => {
	it('ゼロ埋めの無い日付を暦日にする', () => {
		expect(calendarDateOfSlashed('2026/9/5')).toBe('2026-09-05');
		expect(calendarDateOfSlashed('2026/12/25')).toBe('2026-12-25');
		expect(calendarDateOfSlashed('2026-09-05')).toBeNull();
	});
});

describe('parseRequestMail', () => {
	// F-06。5項目を取り出す。ご両家名は空白を落として D列の形にする
	it('裏取りが通れば5項目を返す', () => {
		expect(parseRequestMail('2026/9/5案件詳細です。', body)).toEqual({
			kind: 'project',
			project: {
				serviceDate: '2026-09-05',
				venueCode: 'AAA',
				venueName: '甲ホール',
				coupleName: '〇〇様△△様',
				projectNo: '100000001',
			},
		});
	});

	it('CRLF でも同じ', () => {
		expect(parseRequestMail('2026/9/5案件詳細です。', body.replace(/\n/g, '\r\n')).kind).toBe(
			'project',
		);
	});

	// R-19。取り込まない
	it('依頼無しは no_request', () => {
		expect(parseRequestMail('【9月5日(土) 依頼無しのご連絡】', '本文')).toEqual({
			kind: 'no_request',
		});
	});

	// 同じ差出人から依頼以外のメール（給与明細など）も届く。依頼ではないので失敗扱いにしない（決定23）
	it('件名がどちらでもなければ unrelated（本文は見ない）', () => {
		expect(parseRequestMail('別件', body)).toEqual({ kind: 'unrelated' });
		expect(parseRequestMail('8月度 給与・支払明細書のご送付', '明細は添付のとおりです')).toEqual({
			kind: 'unrelated',
		});
	});

	// F-07 / N-16。1行目の日付が施行日と一致しなければ、2〜3行目を採らない
	it('1行目の日付が施行日行と違えば、会場名と会場コードを採らない', () => {
		const shifted = body.replace('2026/9/5\n甲ホール', '2026/9/6\n甲ホール');
		expect(parseRequestMail('2026/9/5案件詳細です。', shifted)).toEqual({
			kind: 'parse_failed',
			missing: ['会場名', '会場コード', 'ご両家名'],
		});
	});

	it('4行目がご両家名の形でなければ採らない', () => {
		const broken = body.replace('〇〇様 △△様', '〇〇様');
		const parsed = parseRequestMail('2026/9/5案件詳細です。', broken);
		expect(parsed.kind).toBe('parse_failed');
		if (parsed.kind === 'parse_failed') expect(parsed.missing).toContain('ご両家名');
	});

	it('会場コードが英数字5文字までの形でなければ採らない', () => {
		const broken = body.replace('\nAAA\n', '\n甲ホール本館\n');
		const parsed = parseRequestMail('2026/9/5案件詳細です。', broken);
		expect(parsed).toEqual({ kind: 'parse_failed', missing: ['会場コード'] });
	});

	it('案件番号の見出しが無ければ採らない', () => {
		const broken = body.replace('案件番号：100000001', '番号：100000001');
		expect(parseRequestMail('2026/9/5案件詳細です。', broken)).toEqual({
			kind: 'parse_failed',
			missing: ['案件番号'],
		});
	});

	it('リンクの URL は結果に含まれない（叩かない・持たない）', () => {
		const parsed = parseRequestMail('2026/9/5案件詳細です。', body);
		expect(JSON.stringify(parsed)).not.toContain('example.test');
	});
});

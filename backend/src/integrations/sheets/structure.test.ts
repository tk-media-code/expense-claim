import { describe, expect, it } from 'vitest';

import {
	assertHeaderMatches,
	bodyRectangle,
	quoteSheetTitle,
	serialToCalendarDate,
	sheetTitleOfReference,
	targetMonthOfCell,
	venueMasterOf,
	writableRangeOf,
} from './structure.js';

describe('serialToCalendarDate', () => {
	// 要求分析 5.6・実測。2026年8月なら 46235 = 2026-08-01
	it('シリアル値を暦日にする', () => {
		expect(serialToCalendarDate(46235)).toBe('2026-08-01');
		expect(serialToCalendarDate(46266)).toBe('2026-09-01');
		expect(serialToCalendarDate(1)).toBe('1899-12-31');
	});

	it('数でなければ null', () => {
		expect(serialToCalendarDate(Number.NaN)).toBeNull();
	});
});

describe('targetMonthOfCell', () => {
	it('月初のシリアル値なら対象月度', () => {
		expect(targetMonthOfCell(46235)).toBe('2026-08');
	});

	// 要件定義 5.5。対象月度が決まらないまま書けば、自分の申請を壊す
	it.each([
		['文字列', '2026年8月'],
		['空', ''],
		['月初でない', 46236],
		['null', null],
	])('%s なら TARGET_MONTH_UNREADABLE', (_label, value) => {
		expect(() => targetMonthOfCell(value)).toThrow(
			expect.objectContaining({ code: 'TARGET_MONTH_UNREADABLE' }) as Error,
		);
	});
});

describe('assertHeaderMatches', () => {
	const header = [
		'日付',
		'目的地(会場)',
		'目的',
		'案件名(新郎/新婦)',
		'出発駅',
		'到着駅',
		'往復',
		'金額',
		'タクシー',
		'高速代/駐車場',
	];

	it('実測どおりの並びなら通る。K〜M は7行目に値が無くてよい', () => {
		expect(() => assertHeaderMatches(header)).not.toThrow();
		expect(() => assertHeaderMatches([...header, '', '', ''])).not.toThrow();
	});

	// NF-10。列の意味が変わったことに気づかずに書けば、別の欄へ値を書き込む
	it.each([
		['列が入れ替わった', [...header.slice(0, 4), '到着駅', '出発駅', ...header.slice(6)]],
		['列が減った', header.slice(0, 9)],
		['見出しが変わった', ['日付', '会場', ...header.slice(2)]],
	])('%s なら SHEET_FORMAT_CHANGED', (_label, cells) => {
		expect(() => assertHeaderMatches(cells)).toThrow(
			expect.objectContaining({ code: 'SHEET_FORMAT_CHANGED' }) as Error,
		);
	});
});

describe('writableRangeOf', () => {
	// 要求分析 5.2・実測。1〜7行目は編集できず、8〜32行目に編集権がある。グリッドは 33 行
	it('編集できる保護範囲から 8〜32 行を決める', () => {
		expect(
			writableRangeOf(
				[
					{ range: { startRowIndex: 0, endRowIndex: 7 }, requestingUserCanEdit: false },
					{ range: { startRowIndex: 7, endRowIndex: 32 }, requestingUserCanEdit: true },
				],
				33,
			),
		).toEqual({ firstBodyRow: 8, lastBodyRow: 32, writableRows: 25 });
	});

	it('保護範囲がグリッドより長ければ、グリッドの行数で切る', () => {
		expect(
			writableRangeOf(
				[{ range: { startRowIndex: 7, endRowIndex: 37 }, requestingUserCanEdit: true }],
				33,
			),
		).toEqual({ firstBodyRow: 8, lastBodyRow: 33, writableRows: 26 });
	});

	// 要件定義 5.5。保護範囲が読めなければ、どこへ書いてよいか分からない
	it.each([
		['保護範囲が無い', []],
		[
			'編集できる範囲が無い',
			[{ range: { startRowIndex: 0, endRowIndex: 7 }, requestingUserCanEdit: false }],
		],
		['行の範囲を持たない', [{ range: {}, requestingUserCanEdit: true }]],
	])('%s なら WRITABLE_RANGE_UNKNOWN', (_label, ranges) => {
		expect(() => writableRangeOf(ranges, 33)).toThrow(
			expect.objectContaining({ code: 'WRITABLE_RANGE_UNKNOWN' }) as Error,
		);
	});
});

describe('venueMasterOf', () => {
	it('A列をコード、B列を名前にし、空行を飛ばし、名前が無ければコードを名前にする', () => {
		expect(
			venueMasterOf([['AAA', '甲ホール'], [], ['BBB'], ['', '名前だけ'], [' CCC ', ' 丙会館 ']]),
		).toEqual([
			{ code: 'AAA', name: '甲ホール' },
			{ code: 'BBB', name: 'BBB' },
			{ code: 'CCC', name: '丙会館' },
		]);
	});
});

describe('参照とシート名', () => {
	// 要求分析 6.5・実測。B列の入力規則は '会場'!$A:$A を指す
	it('入力規則の参照からシート名を取り出す', () => {
		expect(sheetTitleOfReference("='会場'!$A:$A")).toBe('会場');
		expect(sheetTitleOfReference('会場!A:A')).toBe('会場');
		expect(sheetTitleOfReference('A:A')).toBeNull();
	});

	it('シート名を A1 記法で引用する', () => {
		expect(quoteSheetTitle("1062 甲'乙")).toBe("'1062 甲''乙'");
	});

	describe('bodyRectangle', () => {
		// 05-integration.md 8.2 の図。書く行は値、残りは ""。M8 だけ領収書欄、M9 以降は ""
		it('書ける行数ぶんの矩形を作り、残りは空、M列は先頭だけ', () => {
			const rows = [
				{
					A: '2026/8/22',
					B: 'CCC',
					C: '婚礼案件',
					D: '▲▲様▼▼様',
					E: 'X鉄甲駅',
					F: 'X鉄丙駅',
					G: '往復',
					H: 620,
					I: null,
				},
				{
					A: null,
					B: null,
					C: null,
					D: null,
					E: 'Y鉄丙駅',
					F: 'Y鉄丁駅',
					G: '往復',
					H: 420,
					I: null,
				},
			];
			const rectangle = bodyRectangle(rows, '(8/23)\nhttps://example.test/r', 4);
			expect(rectangle).toHaveLength(4);
			expect(rectangle[0]).toEqual([
				'2026/8/22',
				'CCC',
				'婚礼案件',
				'▲▲様▼▼様',
				'X鉄甲駅',
				'X鉄丙駅',
				'往復',
				620,
				'',
				'',
				'',
				'',
				'(8/23)\nhttps://example.test/r',
			]);
			expect(rectangle[1]).toEqual([
				'',
				'',
				'',
				'',
				'Y鉄丙駅',
				'Y鉄丁駅',
				'往復',
				420,
				'',
				'',
				'',
				'',
				'',
			]);
			expect(rectangle[2]).toEqual(Array<string>(13).fill(''));
			expect(rectangle.every((r) => r.length === 13)).toBe(true);
		});

		it('タクシー代は先頭行の I列に数値で入る', () => {
			const rows = [
				{
					A: '2026/9/5',
					B: 'AAA',
					C: '婚礼案件',
					D: '〇〇様△△様',
					E: 'a',
					F: 'b',
					G: '往復',
					H: 640,
					I: 3200,
				},
			];
			expect(bodyRectangle(rows, '', 1)[0]?.[8]).toBe(3200);
		});
	});
});

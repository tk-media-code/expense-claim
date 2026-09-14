import { describe, expect, it } from 'vitest';

import type { CalendarDate, TargetMonth } from './month.js';
import {
	buildSubmission,
	inTargetMonth,
	receiptCellOf,
	rowsToInsert,
	type SubmissionSource,
} from './submission.js';

// 要件定義 5.6 の架空の例（2026年9月分・案件3件）を、そのまま行に書き下す
function date(value: string): CalendarDate {
	return value as CalendarDate;
}

const a: SubmissionSource = {
	project: {
		id: 1,
		projectNo: '100000001',
		serviceDate: date('2026-09-05'),
		venueCode: 'AAA',
		venueName: '甲ホール',
		coupleName: '〇〇様△△様',
	},
	record: {
		tripType: 'round',
		legs: [
			{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
			{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
		],
	},
	taxiRides: [
		{
			rodeOn: date('2026-09-05'),
			amount: 1800,
			driveUrl: 'https://drive.google.com/file/d/r1/view',
		},
		{
			rodeOn: date('2026-09-05'),
			amount: 1400,
			driveUrl: 'https://drive.google.com/file/d/r2/view',
		},
	],
};
const b: SubmissionSource = {
	project: {
		id: 2,
		projectNo: '100000002',
		serviceDate: date('2026-09-05'),
		venueCode: 'BBB',
		venueName: '乙迎賓館',
		coupleName: '□□様◇◇様',
	},
	record: {
		tripType: 'one_way',
		legs: [
			{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄丁駅', amount: 380 },
			{ sortOrder: 2, fromStationName: 'Y鉄丁駅', toStationName: 'Y鉄戊駅', amount: 210 },
			{ sortOrder: 3, fromStationName: 'Z鉄戊駅', toStationName: 'X鉄甲駅', amount: 520 },
		],
	},
	taxiRides: [],
};
const c: SubmissionSource = {
	project: {
		id: 3,
		projectNo: '100000003',
		serviceDate: date('2026-09-12'),
		venueCode: 'AAA',
		venueName: '甲ホール',
		coupleName: '××様＋＋様',
	},
	record: a.record,
	taxiRides: [],
};

describe('buildSubmission', () => {
	// 要件定義 5.6「書き込まれる行」の表そのまま。8〜14行目の7行
	it('要件定義 5.6 の例が、そのままの7行になる', () => {
		const { rows, receiptCell, warnings } = buildSubmission([a, b, c], new Set(['AAA', 'BBB']));
		expect(warnings).toEqual([]);
		expect(
			rows.map((r) => [
				r.cells.A,
				r.cells.B,
				r.cells.C,
				r.cells.D,
				r.cells.E,
				r.cells.F,
				r.cells.G,
				r.cells.H,
				r.cells.I,
			]),
		).toEqual([
			['2026/9/5', 'AAA', '婚礼案件', '〇〇様△△様', 'X鉄甲駅', 'X鉄乙駅', '往復', 640, 3200],
			[null, null, null, null, 'Y鉄乙駅', 'Y鉄丙駅', '往復', 420, null],
			['2026/9/5', 'BBB', '婚礼案件', '□□様◇◇様', 'X鉄甲駅', 'X鉄丁駅', '片道', 380, null],
			[null, null, null, null, 'Y鉄丁駅', 'Y鉄戊駅', '片道', 210, null],
			[null, null, null, null, 'Z鉄戊駅', 'X鉄甲駅', '片道', 520, null],
			['2026/9/12', 'AAA', '婚礼案件', '××様＋＋様', 'X鉄甲駅', 'X鉄乙駅', '往復', 640, null],
			[null, null, null, null, 'Y鉄乙駅', 'Y鉄丙駅', '往復', 420, null],
		]);
		expect(rows.map((r) => [r.no, r.projectId])).toEqual([
			[1, 1],
			[2, 1],
			[3, 2],
			[4, 2],
			[5, 2],
			[6, 3],
			[7, 3],
		]);
		// 5.4。領収書の URL は2本並ぶ。乗車の数と行の数は一致しない
		expect(receiptCell).toBe(
			'(9/5)\nhttps://drive.google.com/file/d/r1/view\nhttps://drive.google.com/file/d/r2/view',
		);
	});

	// 要件定義 5.5「中止しない」。記録の無い案件は飛ばして警告する
	it('記録の無い案件は飛ばし、NO_EXPENSE_RECORD を返す', () => {
		const { rows, warnings } = buildSubmission([{ ...c, record: null }], new Set(['AAA']));
		expect(rows).toEqual([]);
		expect(warnings).toEqual([
			{
				code: 'NO_EXPENSE_RECORD',
				message: '2026/9/12 甲ホール は交通費の記録がありません。この案件は書き込みません',
				projectId: 3,
			},
		]);
	});

	// N-14。マスタに無いコードは警告して、そのまま書く
	it('会場コードがマスタに無ければ VENUE_CODE_UNKNOWN を返し、行は書く', () => {
		const { rows, warnings } = buildSubmission([b], new Set(['AAA']));
		expect(rows).toHaveLength(3);
		expect(rows[0]?.cells.B).toBe('BBB');
		expect(warnings).toEqual([
			{
				code: 'VENUE_CODE_UNKNOWN',
				message: '会場コード BBB が会場マスタにありません',
				projectId: 2,
			},
		]);
	});

	// 5.4。書いた案件と URL の集合がずれると、行の無い領収書が並ぶ。記録の無い案件の領収書は載せない
	it('記録の無い案件の領収書は領収書欄に載せない', () => {
		const { receiptCell } = buildSubmission([{ ...a, record: null }], new Set(['AAA']));
		expect(receiptCell).toBe('');
	});
});

describe('receiptCellOf', () => {
	it('日付の昇順に見出しを付け、1行に URL は1本', () => {
		expect(
			receiptCellOf([
				{ rodeOn: date('2026-09-12'), driveUrl: 'u3' },
				{ rodeOn: date('2026-09-05'), driveUrl: 'u1' },
				{ rodeOn: date('2026-09-05'), driveUrl: 'u2' },
			]),
		).toBe('(9/5)\nu1\nu2\n(9/12)\nu3');
	});
});

describe('rowsToInsert / inTargetMonth', () => {
	// 要件定義 5.3。10件 × 3区間なら30行で、25行に収まらない
	it('足りないぶんだけ挿入する', () => {
		expect(rowsToInsert(30, 25)).toBe(5);
		expect(rowsToInsert(20, 25)).toBe(0);
	});

	// 決定12 / 決定13。9/1〜9/3 に8月分を提出するとき、9/5 の案件が混ざらない
	it('施行日が対象月度に属する案件だけを残す', () => {
		const items = [{ serviceDate: date('2026-08-31') }, { serviceDate: date('2026-09-05') }];
		expect(inTargetMonth(items, '2026-08' as TargetMonth)).toEqual([
			{ serviceDate: date('2026-08-31') },
		]);
	});
});

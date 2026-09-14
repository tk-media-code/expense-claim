import { describe, expect, it } from 'vitest';

import {
	belongsTo,
	calendarDateOf,
	dayOfMonth,
	firstDayOf,
	firstDayOfNextMonth,
	formatForSheet,
	formatMonthJa,
	isAfter,
	isBefore,
	isSameMonth,
	parseCalendarDate,
	parseTargetMonth,
	projectMonthOf,
	targetMonthOfFirstDay,
	todayInJst,
	type CalendarDate,
	type ProjectMonth,
	type TargetMonth,
} from './month.js';

function date(value: string): CalendarDate {
	const parsed = parseCalendarDate(value);
	if (!parsed) throw new Error(`暦日として読めない: ${value}`);
	return parsed;
}

describe('parseCalendarDate', () => {
	it.each(['2026-09-05', '2026-02-28', '2028-02-29', '2026-12-31'])('%s は暦日', (value) => {
		expect(parseCalendarDate(value)).toBe(value);
	});

	// 03-database.md 4.2。Date を経由しない。暦の上に無い日は読まない
	it.each([
		['2026-02-29', '平年の 2/29'],
		['2026-13-01', '13月'],
		['2026-09-31', '9/31'],
		['2026-9-5', '0 埋めが無い'],
		['2026/09/05', 'スラッシュ'],
		['2026-09-05T00:00:00Z', '時刻付き'],
	])('%s は読まない（%s）', (value) => {
		expect(parseCalendarDate(value)).toBeNull();
	});

	it('calendarDateOf は年月日から組み、末日を越えれば null', () => {
		expect(calendarDateOf(2026, 9, 5)).toBe('2026-09-05');
		expect(calendarDateOf(2026, 9, 31)).toBeNull();
	});
});

describe('月度の導出', () => {
	// 決定12。案件の月度は施行日から導出する
	it('projectMonthOf は施行日の年月', () => {
		expect(projectMonthOf(date('2026-09-05'))).toBe('2026-09');
	});

	// 決定13。A1 は月初の日付。月初でなければ対象月度として読まない
	it('targetMonthOfFirstDay は月初のときだけ対象月度', () => {
		expect(targetMonthOfFirstDay(date('2026-08-01'))).toBe('2026-08');
		expect(targetMonthOfFirstDay(date('2026-08-02'))).toBeNull();
	});

	it('parseTargetMonth は YYYY-MM だけを読む', () => {
		expect(parseTargetMonth('2026-08')).toBe('2026-08');
		expect(parseTargetMonth('2026-13')).toBeNull();
		expect(parseTargetMonth('2026-08-01')).toBeNull();
	});
});

describe('範囲と比較', () => {
	const aug = parseTargetMonth('2026-08') as TargetMonth;
	const sep = parseTargetMonth('2026-09') as TargetMonth;
	const dec = parseTargetMonth('2026-12') as TargetMonth;

	it('firstDayOf / firstDayOfNextMonth は範囲検索の両端（03-database.md 9.1）', () => {
		expect(firstDayOf(aug)).toBe('2026-08-01');
		expect(firstDayOfNextMonth(aug)).toBe('2026-09-01');
		expect(firstDayOfNextMonth(dec)).toBe('2027-01-01');
	});

	// F-28。対象月度の案件だけを書く。8/31 に取り込んだ 9/5 の案件は 8月度に混ざらない
	it('belongsTo は施行日が対象月度に属するか', () => {
		expect(belongsTo(date('2026-08-22'), aug)).toBe(true);
		expect(belongsTo(date('2026-09-05'), aug)).toBe(false);
	});

	// F-32。切替先より前の月度だけが削除・警告の対象になる
	it('isBefore / isSameMonth は案件の月度と対象月度を比べる', () => {
		const augProject = projectMonthOf(date('2026-08-22'));
		const sepProject = projectMonthOf(date('2026-09-05'));
		expect(isBefore(augProject, sep)).toBe(true);
		expect(isBefore(sepProject, sep)).toBe(false);
		expect(isSameMonth(sepProject, sep)).toBe(true);
		expect(isSameMonth(augProject, sep)).toBe(false);
	});

	// 02-screens.md 4.1。今日は施行前ではない
	it('isAfter は施行日が今日より後か（今日を含まない）', () => {
		const today = date('2026-09-05');
		expect(isAfter(date('2026-09-06'), today)).toBe(true);
		expect(isAfter(date('2026-09-05'), today)).toBe(false);
	});

	it('型が違うので === で比べるコードは書けない', () => {
		const month: ProjectMonth = projectMonthOf(date('2026-09-05'));
		// @ts-expect-error ProjectMonth と TargetMonth は互いに代入できない（01-architecture.md 5.4）
		const wrong: TargetMonth = month;
		expect(wrong).toBe('2026-09');
	});
});

describe('JST', () => {
	// 03-database.md 4.2。UTC で判定すると日本時間の1日の朝がまだ前月末になる
	it('todayInJst は UTC の前月末 15:00 を JST の月初にする', () => {
		expect(todayInJst(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09-01');
		expect(todayInJst(new Date('2026-08-31T14:59:59Z'))).toBe('2026-08-31');
	});

	it('dayOfMonth は暦日の日', () => {
		expect(dayOfMonth(date('2026-09-03'))).toBe(3);
	});
});

describe('書式', () => {
	// 要件定義 7.4。2026/9/5 の形で書けば日付として入る
	it('formatForSheet は 0 埋め無しのスラッシュ区切り', () => {
		expect(formatForSheet(date('2026-09-05'))).toBe('2026/9/5');
		expect(formatForSheet(date('2026-12-25'))).toBe('2026/12/25');
	});

	it('formatMonthJa は「2026年8月度」', () => {
		expect(formatMonthJa(parseTargetMonth('2026-08') as TargetMonth)).toBe('2026年8月度');
	});
});

import { describe, expect, it } from 'vitest';

import {
	daysBetween,
	formatDateTime,
	formatMonth,
	formatServiceDate,
	isUpcoming,
	todayInJst,
} from './date';

describe('date', () => {
	// 03-database.md 4.2。UTC の前月末 15:00 は JST の月初
	it('todayInJst は JST の暦日', () => {
		expect(todayInJst(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09-01');
		expect(todayInJst(new Date('2026-08-31T14:59:59Z'))).toBe('2026-08-31');
	});

	// 02-screens.md 4.1。今日は施行前ではない
	it('isUpcoming は今日より後だけ真', () => {
		expect(isUpcoming('2026-09-06', '2026-09-05')).toBe(true);
		expect(isUpcoming('2026-09-05', '2026-09-05')).toBe(false);
	});

	it('formatServiceDate は M/D（曜）', () => {
		expect(formatServiceDate('2026-09-05')).toBe('9/5（土）');
		expect(formatServiceDate('2026-12-31')).toBe('12/31（木）');
	});

	it('formatMonth は YYYY年M月度', () => {
		expect(formatMonth('2026-08')).toBe('2026年8月度');
	});

	it('formatDateTime は JST の M/D HH:mm', () => {
		expect(formatDateTime('2026-09-05T09:42:00Z')).toBe('9/5 18:42');
	});

	it('daysBetween は JST の暦日の差', () => {
		expect(daysBetween('2026-09-03T00:00:00Z', new Date('2026-09-05T00:00:00Z'))).toBe(2);
		expect(daysBetween('2026-09-04T20:00:00Z', new Date('2026-09-05T00:00:00Z'))).toBe(0);
	});
});

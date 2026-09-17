import { describe, expect, it } from 'vitest';

import { todayInJst } from './domain/month.js';
import { parseSchedulerArgs } from './scheduler-args.js';

describe('scheduler の引数', () => {
	it('引数なしは常駐', () => {
		expect(parseSchedulerArgs([])).toEqual({ once: false, now: null });
	});

	it('--once は1回だけ走り、日付は差し替えない', () => {
		expect(parseSchedulerArgs(['--once'])).toEqual({ once: true, now: null });
	});

	// 1日と3日の朝にしか送らないので、送る側を手で確かめるには日付を与える
	it('--at はその日の 07:00（JST）として1回走る', () => {
		const args = parseSchedulerArgs(['--at=2026-10-01']);
		expect(args.once).toBe(true);
		expect(args.now?.toISOString()).toBe('2026-09-30T22:00:00.000Z');
		expect(todayInJst(args.now as Date)).toBe('2026-10-01');
	});

	it('--at が暦の上にない日なら落ちる', () => {
		expect(() => parseSchedulerArgs(['--at=2026-02-30'])).toThrow('--at は');
		expect(() => parseSchedulerArgs(['--at=20261001'])).toThrow('--at は');
	});
});

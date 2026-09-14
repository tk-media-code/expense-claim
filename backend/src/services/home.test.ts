import { describe, expect, it, vi } from 'vitest';

import { parseCalendarDate, parseTargetMonth, type CalendarDate } from '../domain/month.js';
import type { Project } from '../domain/project.js';
import type { SyncState } from '../domain/sync-state.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';
import { createHomeService } from './home.js';

// 案件は架空の値だけを使う（公開リポジトリ）。02-screens.md 2.4 のデータ（8月度2件・9月度4件）に合わせる
function date(value: string): CalendarDate {
	const parsed = parseCalendarDate(value);
	if (!parsed) throw new Error(`暦日として読めない: ${value}`);
	return parsed;
}

function project(id: number, projectNo: string, serviceDate: string, venueCode: string): Project {
	const d = date(serviceDate);
	return {
		id,
		projectNo,
		serviceDate: d,
		month: d.slice(0, 7) as Project['month'],
		venueCode,
		venueName: `${venueCode}会場`,
		coupleName: '〇〇様△△様',
		source: 'mail',
	};
}

const aug22 = project(1, '100000011', '2026-08-22', 'CCC');
const aug23 = project(2, '100000012', '2026-08-23', 'DDD');
const sep5a = project(3, '100000001', '2026-09-05', 'AAA');
const sep5b = project(4, '100000002', '2026-09-05', 'BBB');

function createFakes(options: { projects?: Project[]; syncState?: SyncState | null } = {}) {
	const listFrom = vi.fn<ProjectsRepository['listFrom']>(() =>
		Promise.resolve(options.projects ?? []),
	);
	const projectsRepository = { listFrom } as unknown as ProjectsRepository;
	const syncStateRepository = {
		find: vi.fn<SyncStateRepository['find']>(() => Promise.resolve(options.syncState ?? null)),
	} as unknown as SyncStateRepository;
	return { service: createHomeService(projectsRepository, syncStateRepository), listFrom };
}

const synced: SyncState = {
	lastImportedAt: new Date('2026-09-05T09:42:00Z'),
	lastSeenTargetMonth: parseTargetMonth('2026-08'),
	lastAlertSentOn: null,
	lastCronRunAt: new Date('2026-09-05T00:00:00Z'),
	updatedAt: new Date('2026-09-05T09:42:00Z'),
};

describe('home service', () => {
	// 04-api.md 5.1。月度の降順、月度の中では repository の順（施行日の昇順）
	it('対象月度以降の案件を月度ごとに束ね、月度の降順で返す', async () => {
		const { service, listFrom } = createFakes({
			projects: [aug22, aug23, sep5a, sep5b],
			syncState: synced,
		});
		const home = await service.get();

		expect(listFrom).toHaveBeenCalledWith('2026-08-01');
		expect(home.targetMonth).toBe('2026-08');
		expect(home.lastImportedAt).toEqual(new Date('2026-09-05T09:42:00Z'));
		expect(home.lastCronRunAt).toEqual(new Date('2026-09-05T00:00:00Z'));
		expect(home.months.map((m) => m.month)).toEqual(['2026-09', '2026-08']);
		expect(home.months[0]?.projects.map((p) => p.id)).toEqual([3, 4]);
		expect(home.months[1]?.projects.map((p) => p.id)).toEqual([1, 2]);
	});

	// 02-screens.md 4.2。対象月度は提出待ち、それより後はこれから稼働
	it('対象月度は due、それより後の月度は upcoming', async () => {
		const { service } = createFakes({ projects: [aug22, sep5a], syncState: synced });
		const home = await service.get();
		expect(home.months.map((m) => [m.month, m.state])).toEqual([
			['2026-09', 'upcoming'],
			['2026-08', 'due'],
		]);
	});

	it('案件カードの項目を持ち、記録の有無は Phase 4-5 までは未記録', async () => {
		const { service } = createFakes({ projects: [sep5a], syncState: synced });
		const home = await service.get();
		expect(home.months[0]?.projects[0]).toEqual({
			id: 3,
			projectNo: '100000001',
			serviceDate: '2026-09-05',
			venueCode: 'AAA',
			venueName: 'AAA会場',
			coupleName: '〇〇様△△様',
			recorded: false,
			totalAmount: null,
			taxiCount: 0,
		});
	});

	// 一度も同期していなければ対象月度が無い。案件は全件出し、どれも提出待ちにしない
	it('同期前は targetMonth が null で、全件を upcoming として返す', async () => {
		const { service, listFrom } = createFakes({ projects: [aug22, sep5a] });
		const home = await service.get();
		expect(listFrom).toHaveBeenCalledWith(null);
		expect(home.targetMonth).toBeNull();
		expect(home.lastImportedAt).toBeNull();
		expect(home.months.every((m) => m.state === 'upcoming')).toBe(true);
	});

	it('案件が無ければ months は空', async () => {
		const { service } = createFakes({ syncState: synced });
		await expect(service.get()).resolves.toMatchObject({ months: [], attentionCount: 0 });
	});
});

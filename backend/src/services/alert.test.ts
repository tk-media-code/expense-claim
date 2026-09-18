import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/app-error.js';
import { parseTargetMonth, type CalendarDate, type TargetMonth } from '../domain/month.js';
import type { Project } from '../domain/project.js';
import type { SyncState } from '../domain/sync-state.js';
import type { GmailClient } from '../integrations/gmail/client.js';
import { GoogleApiFailure } from '../integrations/google/errors.js';
import type { SheetsClient } from '../integrations/sheets/client.js';
import type { AttentionsService } from './attentions.js';
import type { ExpenseRecordsRepository } from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { SubmissionsRepository } from '../repositories/submissions.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';
import { composeAlert, createAlertService } from './alert.js';

// 提出アラートの判定（要件定義 7.5）。JST の暦日で「1日か3日か」を見る。値は架空
function createFakes(
	options: {
		targetMonth?: string | null;
		sheetsFail?: boolean;
		submitted?: boolean;
		lastAlertSentOn?: string | null;
		sendFails?: boolean;
	} = {},
) {
	const saved: SyncState[] = [];
	let state: SyncState | null = {
		lastImportedAt: null,
		lastSeenTargetMonth: null,
		lastAlertSentOn: options.lastAlertSentOn ?? null,
		lastCronRunAt: null,
		updatedAt: new Date('2026-08-01T00:00:00Z'),
	};
	const syncStateRepository = {
		find: vi.fn<SyncStateRepository['find']>(() => Promise.resolve(state)),
		save: vi.fn<SyncStateRepository['save']>((next) => {
			state = next;
			saved.push(next);
			return Promise.resolve();
		}),
	} as unknown as SyncStateRepository;
	const sheets = {
		readTargetMonth: vi.fn<SheetsClient['readTargetMonth']>(() =>
			options.sheetsFail
				? Promise.reject(new AppError('SHEET_UNREACHABLE'))
				: Promise.resolve(parseTargetMonth(options.targetMonth ?? '2026-08') as TargetMonth),
		),
	} as unknown as SheetsClient;
	const sent: { subject: string; body: string }[] = [];
	const gmail = {
		sendAlert: vi.fn<GmailClient['sendAlert']>((subject, body) => {
			if (options.sendFails) return Promise.reject(new GoogleApiFailure('forbidden', 403));
			sent.push({ subject, body });
			return Promise.resolve();
		}),
	} as unknown as GmailClient;
	const submissionsRepository = {
		findLatest: vi.fn<SubmissionsRepository['findLatest']>((month) =>
			Promise.resolve(
				options.submitted ? { targetMonth: month, executedAt: new Date(), writtenRows: 3 } : null,
			),
		),
	} as unknown as SubmissionsRepository;
	const project = (id: number): Project => ({
		id,
		projectNo: String(id),
		serviceDate: '2026-08-22' as CalendarDate,
		month: '2026-08' as Project['month'],
		venueCode: 'AAA',
		venueName: '甲ホール',
		coupleName: '〇〇様△△様',
		source: 'mail',
	});
	const projectsRepository = {
		listInMonth: vi.fn<ProjectsRepository['listInMonth']>(() =>
			Promise.resolve([project(1), project(2), project(3)]),
		),
	} as unknown as ProjectsRepository;
	const expenseRecordsRepository = {
		summarize: vi.fn<ExpenseRecordsRepository['summarize']>(() =>
			Promise.resolve(
				new Map([
					[1, { projectId: 1, tripType: 'round', total: 1 }],
					[2, { projectId: 2, tripType: 'round', total: 1 }],
				]),
			),
		),
	} as unknown as ExpenseRecordsRepository;
	const recorded: { kind: string; detail: string }[] = [];
	const attentions = {
		record: vi.fn<AttentionsService['record']>((kind, detail) => {
			recorded.push({ kind, detail });
			return Promise.resolve({ id: 1, kind, detail, occurredAt: new Date(), checkedAt: null });
		}),
	} as unknown as AttentionsService;
	const service = createAlertService(
		sheets,
		gmail,
		syncStateRepository,
		submissionsRepository,
		projectsRepository,
		expenseRecordsRepository,
		attentions,
		{ appUrl: 'https://app.example.test/' },
	);
	return { service, sent, saved, recorded, state: () => state };
}

// JST の 9/1 07:00 = UTC の 8/31 22:00
const sep1 = new Date('2026-08-31T22:00:00Z');
const sep3 = new Date('2026-09-02T22:00:00Z');
const sep2 = new Date('2026-09-01T22:00:00Z');

describe('alert service', () => {
	// 06-error-handling.md 7.2。何もしない日でも「走った」ことを残す
	it('1日でも3日でもなければ何もせず、cron の死活だけ更新する', async () => {
		const { service, sent, saved } = createFakes();
		await expect(service.run(sep2)).resolves.toEqual({ kind: 'skipped', reason: 'not_alert_day' });
		expect(sent).toEqual([]);
		expect(saved[0]?.lastCronRunAt).toEqual(sep2);
	});

	// F-35。1日の朝、対象月度が未提出なら1通送る。載せるもの（要件定義 4.10）
	it('1日に未提出なら送り、対象月度・締切・件数・URL を載せ、送った日を残す', async () => {
		const { service, sent, state } = createFakes({ targetMonth: '2026-08' });
		await expect(service.run(sep1)).resolves.toEqual({ kind: 'sent', targetMonth: '2026-08' });
		expect(sent).toHaveLength(1);
		expect(sent[0]?.subject).toContain('2026年8月度の提出がまだです');
		expect(sent[0]?.body).toContain('締切: 2026年9月3日 正午');
		expect(sent[0]?.body).toContain('記録済み: 2件 / 未記録: 1件');
		expect(sent[0]?.body).toContain('https://app.example.test/');
		expect(sent[0]?.body).not.toContain('要確認');
		expect(state()?.lastAlertSentOn).toBe('2026-09-01');
	});

	it('3日は最終警告の件名になる', async () => {
		const { service, sent } = createFakes({ targetMonth: '2026-08' });
		await service.run(sep3);
		expect(sent[0]?.subject).toContain('提出期限は本日正午です');
	});

	// F-36。提出が済んでいれば送らない
	it('提出済みなら送らない', async () => {
		const { service, sent } = createFakes({ targetMonth: '2026-08', submitted: true });
		await expect(service.run(sep1)).resolves.toEqual({ kind: 'skipped', reason: 'submitted' });
		expect(sent).toEqual([]);
	});

	// 03-database.md 5.3。同じ日に2通送らない
	it('同じ日に既に送っていれば送らない', async () => {
		const { service, sent } = createFakes({
			targetMonth: '2026-08',
			lastAlertSentOn: '2026-09-01',
		});
		await expect(service.run(sep1)).resolves.toEqual({
			kind: 'skipped',
			reason: 'already_sent_today',
		});
		expect(sent).toEqual([]);
	});

	// 要件定義 7.5。読めなかったときは対象月度を書かずに送る。読めないから黙る、にしない
	it('対象月度を読めなくても送り、要確認事項に残す', async () => {
		const { service, sent, recorded } = createFakes({ sheetsFail: true });
		await expect(service.run(sep1)).resolves.toEqual({ kind: 'sent', targetMonth: null });
		expect(sent[0]?.subject).toContain('対象月度（提出シートを読めませんでした）');
		expect(sent[0]?.body).toContain('提出シートを読めなかったため');
		expect(recorded.map((a) => a.kind)).toEqual(['sheet_unreachable']);
	});

	// 06-error-handling.md 3.1。送れなかったら alert_send_failed。宛先は入れない
	it('送信に失敗したら要確認事項に残し、送った日は更新しない', async () => {
		const { service, recorded, state } = createFakes({ targetMonth: '2026-08', sendFails: true });
		await expect(service.run(sep1)).resolves.toEqual({ kind: 'failed' });
		expect(recorded.map((a) => a.kind)).toEqual(['alert_send_failed']);
		expect(recorded[0]?.detail).toContain('1日ぶん');
		expect(recorded[0]?.detail).not.toContain('@');
		expect(state()?.lastAlertSentOn).toBeNull();
	});
});

describe('composeAlert', () => {
	it('URL が空なら載せない', () => {
		const { body } = composeAlert(
			'2026-08' as TargetMonth,
			1,
			'2026-09-01' as CalendarDate,
			{ recorded: 1, unrecorded: 0 },
			'',
		);
		expect(body).not.toContain('http');
		expect(body).not.toContain('未記録の案件があります');
	});
});

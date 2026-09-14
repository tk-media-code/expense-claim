import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthedApp, createFakeDrive } from '../../test/app.js';
import { createTestDatabase, createTestPool, truncateAll } from '../../test/database.js';
import { receipts, taxiRides } from '../db/schema.js';

// POST /api/projects/:id/taxi-rides と DELETE /api/taxi-rides/:id（04-api.md 4.6 / 5.5）を、
// 偽物のドライブで確かめる。値は架空
const pool: Pool = createTestPool();
const db = createTestDatabase(pool);

async function jsonPost(
	request: ReturnType<typeof createAuthedApp>['request'],
	path: string,
	body: unknown,
) {
	const res = await request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return (await res.json()) as { id: number };
}

async function setup(request: ReturnType<typeof createAuthedApp>['request']): Promise<number> {
	await jsonPost(request, '/api/venues', { code: 'AAA', name: '甲ホール' });
	const project = await jsonPost(request, '/api/projects', {
		projectNo: '100000001',
		serviceDate: '2026-09-05',
		venueCode: 'AAA',
		coupleName: '〇〇様△△様',
	});
	return project.id;
}

function form(fields: Record<string, string | Blob | undefined>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		if (value instanceof Blob) data.append(key, value, 'IMG_1234.jpg');
		else data.append(key, value);
	}
	return data;
}

const jpeg = () =>
	new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });

beforeEach(async () => {
	await truncateAll(pool);
});

afterAll(async () => {
	await pool.end();
});

describe('POST /api/projects/:id/taxi-rides', () => {
	// F-22〜F-26。保存 → 共有 → DB。ファイル名はアプリが付け、driveFileId は返さない
	it('201 で乗車と領収書を返し、ファイル名を付け、乗車日は省けば施行日', async () => {
		const drive = createFakeDrive();
		const { request } = createAuthedApp(db, undefined, undefined, undefined, undefined, drive);
		const projectId = await setup(request);
		const res = await request(`/api/projects/${projectId}/taxi-rides`, {
			method: 'POST',
			body: form({ amount: '1800', receipt: jpeg() }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({
			id: expect.any(Number) as unknown,
			rodeOn: '2026-09-05',
			amount: 1800,
			receipt: {
				fileName: '20260905_AAA_1.jpg',
				driveUrl: 'https://drive.google.com/file/d/file-1/view',
			},
		});
		expect(JSON.stringify(body)).not.toContain('driveFileId');
		expect(drive.stored).toEqual([
			{ name: '20260905_AAA_1.jpg', mimeType: 'image/jpeg', bytes: 7 },
		]);
	});

	// R-12。1日に複数回乗る。連番が増える
	it('2回目は連番が 2 になり、案件の乗車が2件になる', async () => {
		const drive = createFakeDrive();
		const { request } = createAuthedApp(db, undefined, undefined, undefined, undefined, drive);
		const projectId = await setup(request);
		await request(`/api/projects/${projectId}/taxi-rides`, {
			method: 'POST',
			body: form({ amount: '1800', receipt: jpeg() }),
		});
		const res = await request(`/api/projects/${projectId}/taxi-rides`, {
			method: 'POST',
			body: form({
				amount: '1400',
				rodeOn: '2026-09-05',
				receipt: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
			}),
		});
		await expect(res.json()).resolves.toMatchObject({
			receipt: { fileName: '20260905_AAA_2.pdf' },
		});

		const view = (await (await request(`/api/projects/${projectId}/expense-record`)).json()) as {
			taxiRides: unknown[];
		};
		expect(view.taxiRides).toHaveLength(2);
		const detail = (await (await request(`/api/projects/${projectId}`)).json()) as {
			taxiCount: number;
		};
		expect(detail.taxiCount).toBe(2);
		const home = (await (await request('/api/home')).json()) as {
			months: { projects: { taxiCount: number }[] }[];
		};
		expect(home.months[0]?.projects[0]?.taxiCount).toBe(2);
	});

	// F-26 / 06-error-handling.md 6.2。途中で失敗したら 502 で、DB には何も残らず、要確認事項に残る
	it.each([
		['保存', 'create', 'ドライブに保存できませんでした'],
		['共有', 'share', '共有を付けられませんでした'],
	] as const)(
		'%sで失敗すると 502 で DB は空のまま、要確認事項にどの段かを残す',
		async (_label, step, phrase) => {
			const { request } = createAuthedApp(
				db,
				undefined,
				undefined,
				undefined,
				undefined,
				createFakeDrive({ fails: step }),
			);
			const projectId = await setup(request);
			const res = await request(`/api/projects/${projectId}/taxi-rides`, {
				method: 'POST',
				body: form({ amount: '1800', receipt: jpeg() }),
			});
			expect(res.status).toBe(502);
			await expect(res.json()).resolves.toMatchObject({ error: { code: 'DRIVE_UPLOAD_FAILED' } });
			await expect(db.select().from(taxiRides)).resolves.toEqual([]);
			await expect(db.select().from(receipts)).resolves.toEqual([]);
			const attentions = (await (await request('/api/attentions?checked=false')).json()) as {
				attentions: { kind: string; detail: string }[];
			};
			expect(attentions.attentions[0]?.kind).toBe('drive_upload_failed');
			expect(attentions.attentions[0]?.detail).toContain(phrase);
			expect(attentions.attentions[0]?.detail).toContain('20260905_AAA_1.jpg');
		},
	);

	it('認可切れなら 503', async () => {
		const { request } = createAuthedApp(
			db,
			undefined,
			undefined,
			undefined,
			undefined,
			createFakeDrive({ fails: 'unauthorized' }),
		);
		const projectId = await setup(request);
		const res = await request(`/api/projects/${projectId}/taxi-rides`, {
			method: 'POST',
			body: form({ amount: '1800', receipt: jpeg() }),
		});
		expect(res.status).toBe(503);
	});

	// 05-integration.md 6.2。File.type で先に弾く。通らないものをドライブへ送らない
	it.each([
		[
			'画像でも PDF でもない',
			{ amount: '1800', receipt: new Blob(['x'], { type: 'text/plain' }) },
			'画像か PDF',
		],
		['ファイルが無い', { amount: '1800' }, 'ファイルを選んでください'],
		['金額が無い', { receipt: jpeg() }, '金額は0以上の整数'],
		['金額が負', { amount: '-1', receipt: jpeg() }, '金額は0以上の整数'],
		[
			'乗車日が壊れている',
			{ amount: '1800', rodeOn: '2026/9/5', receipt: jpeg() },
			'乗車日は YYYY-MM-DD',
		],
	])('%s なら 422 で、ドライブへ送らない', async (_label, fields, phrase) => {
		const drive = createFakeDrive();
		const { request } = createAuthedApp(db, undefined, undefined, undefined, undefined, drive);
		const projectId = await setup(request);
		const res = await request(`/api/projects/${projectId}/taxi-rides`, {
			method: 'POST',
			body: form(fields),
		});
		expect(res.status).toBe(422);
		const body = (await res.json()) as { error: { message: string } };
		expect(body.error.message).toContain(phrase);
		expect(drive.stored).toEqual([]);
	});

	it('無い案件なら 404', async () => {
		const { request } = createAuthedApp(db);
		const res = await request('/api/projects/9999/taxi-rides', {
			method: 'POST',
			body: form({ amount: '1800', receipt: jpeg() }),
		});
		expect(res.status).toBe(404);
	});
});

describe('DELETE /api/taxi-rides/:id', () => {
	// 要件定義 6.4。行は消えるが、ドライブのファイル実体は消えない（消す経路が無い）
	it('204 で乗車と領収書の行が消える', async () => {
		const drive = createFakeDrive();
		const { request } = createAuthedApp(db, undefined, undefined, undefined, undefined, drive);
		const projectId = await setup(request);
		const created = (await (
			await request(`/api/projects/${projectId}/taxi-rides`, {
				method: 'POST',
				body: form({ amount: '1800', receipt: jpeg() }),
			})
		).json()) as { id: number };
		const res = await request(`/api/taxi-rides/${created.id}`, { method: 'DELETE' });
		expect(res.status).toBe(204);
		await expect(db.select().from(taxiRides)).resolves.toEqual([]);
		await expect(db.select().from(receipts)).resolves.toEqual([]);
		expect(drive.stored).toHaveLength(1);
	});

	it('無い id なら 404', async () => {
		const { request } = createAuthedApp(db);
		expect((await request('/api/taxi-rides/9999', { method: 'DELETE' })).status).toBe(404);
	});
});

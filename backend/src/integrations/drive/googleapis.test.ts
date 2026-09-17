import type { OAuth2Client } from 'google-auth-library';
import type { drive_v3 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';

import type { GoogleClientProvider } from '../google/auth.js';
import { createDriveClient, DriveStep } from './googleapis.js';

// Drive API を偽物にし、保存 → 共有の順と、どの段で落ちたかの印を確かめる。値は架空
const provider: GoogleClientProvider = { client: () => Promise.resolve({} as OAuth2Client) };
const config = { folderId: 'folder-id' };

type CreateParams = drive_v3.Params$Resource$Files$Create;
type PermissionParams = drive_v3.Params$Resource$Permissions$Create;

// googleapis の失敗は Error のサブクラス（GaxiosError）で、HTTP の状態は code に載る。それを模す
function apiError(code: number): Error {
	return Object.assign(new Error(`Request failed with status code ${code}`), { code });
}

function fakeDrive(options: { createFails?: Error; shareFails?: Error } = {}) {
	const create = vi.fn<(params: CreateParams) => Promise<{ data: drive_v3.Schema$File }>>(() =>
		options.createFails
			? Promise.reject(options.createFails)
			: Promise.resolve({
					data: { id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' },
				}),
	);
	const permissionsCreate = vi.fn<
		(params: PermissionParams) => Promise<{ data: drive_v3.Schema$Permission }>
	>(() =>
		options.shareFails
			? Promise.reject(options.shareFails)
			: Promise.resolve({ data: { id: 'p' } }),
	);
	const drive = {
		files: { create },
		permissions: { create: permissionsCreate },
	} as unknown as drive_v3.Drive;
	return { create, permissionsCreate, drive };
}

function file() {
	return {
		name: '20260905_AAA_1.jpg',
		mimeType: 'image/jpeg',
		body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
	};
}

describe('drive client', () => {
	// 05-integration.md 6.1 / 6.2。親は既存フォルダ、fields に webViewLink、共有は anyone / reader
	it('保存して共有を付け、URL を返す', async () => {
		const fake = fakeDrive();
		await expect(
			createDriveClient(provider, config, () => fake.drive).store(file()),
		).resolves.toEqual({
			fileId: 'file-1',
			url: 'https://drive.google.com/file/d/file-1/view',
		});
		expect(fake.create.mock.calls[0]?.[0]).toMatchObject({
			requestBody: { name: '20260905_AAA_1.jpg', parents: ['folder-id'], mimeType: 'image/jpeg' },
			fields: 'id,webViewLink',
		});
		expect(fake.permissionsCreate.mock.calls[0]?.[0]).toMatchObject({
			fileId: 'file-1',
			requestBody: { type: 'anyone', role: 'reader' },
		});
	});

	// 06-error-handling.md 4.2。保存で落ちたか共有で落ちたかを文面に入れるため、段を持つ
	it('保存で落ちれば DRIVE_UPLOAD_FAILED で、段は create', async () => {
		const fake = fakeDrive({ createFails: apiError(404) });
		const error = await createDriveClient(provider, config, () => fake.drive)
			.store(file())
			.catch((e: unknown) => e);
		expect(error).toMatchObject({ code: 'DRIVE_UPLOAD_FAILED' });
		expect((error as Error).cause).toBeInstanceOf(DriveStep);
		expect(((error as Error).cause as DriveStep).step).toBe('create');
		expect(fake.permissionsCreate).not.toHaveBeenCalled();
	});

	it('共有で落ちれば DRIVE_UPLOAD_FAILED で、段は share', async () => {
		const fake = fakeDrive({ shareFails: apiError(403) });
		const error = await createDriveClient(provider, config, () => fake.drive)
			.store(file())
			.catch((e: unknown) => e);
		expect(((error as Error).cause as DriveStep).step).toBe('share');
	});

	// 05-integration.md 2.4。認可切れは 503
	it('認可切れなら GOOGLE_UNAUTHORIZED', async () => {
		const fake = fakeDrive({ createFails: apiError(401) });
		await expect(
			createDriveClient(provider, config, () => fake.drive).store(file()),
		).rejects.toMatchObject({
			code: 'GOOGLE_UNAUTHORIZED',
		});
	});

	it('保管先が未設定なら Google を叩かずに失敗する', async () => {
		const fake = fakeDrive();
		await expect(
			createDriveClient(provider, { folderId: '' }, () => fake.drive).store(file()),
		).rejects.toMatchObject({
			code: 'DRIVE_UPLOAD_FAILED',
		});
		expect(fake.create).not.toHaveBeenCalled();
	});
});

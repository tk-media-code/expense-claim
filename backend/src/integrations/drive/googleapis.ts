import type { OAuth2Client } from 'google-auth-library';
import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';

import { AppError } from '../../domain/app-error.js';
import type { GoogleClientProvider } from '../google/auth.js';
import { toAppError } from '../google/errors.js';
import type { DriveClient, ReceiptFile, StoredReceipt } from './client.js';

export type DriveConfig = {
	/** 保管先フォルダ。1つで、月ごとに分けない（要件定義 7.3） */
	folderId: string;
};

/** どの段で落ちたかを文面に入れる（06-error-handling.md 4.2）ために、cause に添える */
export class DriveStep extends Error {
	constructor(readonly step: 'create' | 'share') {
		super(step === 'create' ? '保存で落ちた' : '共有で落ちた');
	}
}

// 05-integration.md 6章を googleapis で実装する。叩く呼び出しは files.create と permissions.create の2本（2.2）。
// tools/drive-probe/probe.cjs で実測した手順そのまま。drive.file で足りる（3.3）
export function createDriveClient(
	provider: GoogleClientProvider,
	config: DriveConfig,
	// テストが偽物の Drive API を差し込む。本番は googleapis の実物
	driveOf: (auth: OAuth2Client) => drive_v3.Drive = (auth) => google.drive({ version: 'v3', auth }),
): DriveClient {
	return {
		configured: config.folderId !== '',

		async store(file: ReceiptFile): Promise<StoredReceipt> {
			if (config.folderId === '') {
				throw new AppError('DRIVE_UPLOAD_FAILED', {
					message: '領収書の保管先フォルダが設定されていません',
				});
			}
			let drive: drive_v3.Drive;
			try {
				drive = driveOf(await provider.client());
			} catch (cause) {
				throw toAppError(cause, 'DRIVE_UPLOAD_FAILED');
			}

			// ② files.create。親は人が手で作った既存フォルダ。webViewLink は fields に書かないと返らない
			let fileId: string;
			let url: string;
			try {
				const res = await drive.files.create({
					requestBody: { name: file.name, parents: [config.folderId], mimeType: file.mimeType },
					media: { mimeType: file.mimeType, body: Readable.fromWeb(file.body as never) },
					fields: 'id,webViewLink',
					supportsAllDrives: true,
				});
				if (!res.data.id || !res.data.webViewLink) {
					throw new Error('files.create が id か webViewLink を返さなかった');
				}
				fileId = res.data.id;
				url = res.data.webViewLink;
			} catch (cause) {
				throw toAppError(new DriveStep('create'), 'DRIVE_UPLOAD_FAILED', cause);
			}

			// ③ permissions.create。anyone / reader。フォルダに付けて継承させない（N-19）
			try {
				await drive.permissions.create({
					fileId,
					requestBody: { type: 'anyone', role: 'reader' },
					fields: 'id',
					supportsAllDrives: true,
				});
			} catch (cause) {
				// ②で作ったファイルは残る（孤児）。消さない（6.3）
				throw toAppError(new DriveStep('share'), 'DRIVE_UPLOAD_FAILED', cause);
			}

			return { fileId, url };
		},
	};
}

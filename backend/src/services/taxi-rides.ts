import { AppError } from '../domain/app-error.js';
import type { CalendarDate } from '../domain/month.js';
import { extensionOf, receiptFileName, type TaxiRide } from '../domain/taxi-ride.js';
import type { DriveClient } from '../integrations/drive/client.js';
import { DriveStep } from '../integrations/drive/googleapis.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { TaxiRidesRepository } from '../repositories/taxi-rides.js';
import type { AttentionsService } from './attentions.js';

/** POST の本文（04-api.md 5.5）。ファイル名はクライアントから受け取らない */
export type TaxiRideAddInput = {
	amount: number;
	/** 省略なら案件の施行日 */
	rodeOn: CalendarDate | null;
	file: { mimeType: string; body: ReadableStream<Uint8Array> };
};

// タクシー乗車と領収書（F-22〜F-26）。1回のリクエストの中で、ドライブへの保存 → 共有の付与 →
// DB への書き込みを通す（04-api.md 4.6）。途中で失敗したら 502 で、DB には何も残さない
export function createTaxiRidesService(
	repository: TaxiRidesRepository,
	projectsRepository: ProjectsRepository,
	drive: DriveClient,
	attentions: AttentionsService,
) {
	return {
		async add(projectId: number, input: TaxiRideAddInput): Promise<TaxiRide> {
			const project = await projectsRepository.findById(projectId);
			if (project === null) throw new AppError('NOT_FOUND');

			// ① 種別を確かめる（F-23 / R-13）。本文を読む前に分かる。通らないものをドライブへ送らない
			const extension = extensionOf(input.file.mimeType);
			if (!extension) {
				throw new AppError('INVALID_VALUE', {
					message: '領収書は画像か PDF のファイルにしてください',
				});
			}

			const rodeOn = input.rodeOn ?? project.serviceDate;
			const sequence = (await repository.countByProjectId(projectId)) + 1;
			const fileName = receiptFileName(rodeOn, project.venueCode, sequence, extension);

			// ②③ 保存と共有。失敗したら要確認事項に残し、DB は空のまま（06-error-handling.md 6.2）
			let stored;
			try {
				stored = await drive.store({
					name: fileName,
					mimeType: input.file.mimeType,
					body: input.file.body,
				});
			} catch (cause) {
				if (cause instanceof AppError && cause.code === 'DRIVE_UPLOAD_FAILED') {
					const step = cause.cause instanceof DriveStep ? cause.cause.step : null;
					await attentions.record(
						'drive_upload_failed',
						`${project.serviceDate.replace(/-/g, '/')} ${project.venueName} の領収書（${fileName}）を${
							step === 'share'
								? 'ドライブに保存しましたが、共有を付けられませんでした'
								: 'ドライブに保存できませんでした'
						}。乗車は記録していません。もう一度やり直してください`,
					);
				}
				throw cause;
			}

			// ④ ここまで通って初めて DB に書く（F-26）
			return repository.create(
				projectId,
				{ rodeOn, amount: input.amount },
				{
					driveFileId: stored.fileId,
					driveUrl: stored.url,
					fileName,
					mimeType: input.file.mimeType,
				},
				new Date(),
			);
		},

		// 消す。ドライブのファイル実体は消さない（要件定義 6.4）
		async remove(id: number): Promise<void> {
			if ((await repository.findById(id)) === null) throw new AppError('NOT_FOUND');
			await repository.remove(id);
		},
	};
}

export type TaxiRidesService = ReturnType<typeof createTaxiRidesService>;

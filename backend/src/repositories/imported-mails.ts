import { inArray } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { importedMails, projects } from '../db/schema.js';
import type { ParsedProject } from '../domain/mail-parse.js';

/** 1通のメールの識別子（03-database.md 5.3）。本文は持たない */
export type ImportedMailMeta = { id: string; threadId: string | null; internalDate: Date | null };
export type ImportResult = 'project' | 'no_request' | 'unrelated' | 'parse_failed';

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
export function createImportedMailsRepository(db: Database) {
	return {
		// 既に読んだメールを飛ばす（F-08 / 要件定義 7.2 手順4）
		async existingIds(ids: string[]): Promise<Set<string>> {
			if (ids.length === 0) return new Set();
			const rows = await db
				.select({ id: importedMails.id })
				.from(importedMails)
				.where(inArray(importedMails.id, ids));
			return new Set(rows.map((row) => row.id));
		},

		// 案件にしないメール（依頼無し・解析失敗）も行を残す。次回に飛ばすため（03-database.md 5.3）
		async record(
			mail: ImportedMailMeta,
			result: Exclude<ImportResult, 'project'>,
			at: Date,
		): Promise<void> {
			await db.insert(importedMails).values({ ...mail, result, processedAt: at });
		},

		/**
		 * メールと案件を1組で書く（06-error-handling.md 6.4「1通ずつ囲む」）。
		 * 同じ案件番号が既にあれば案件は増やさず、そのメールを取り込み元として紐付ける（F-08。
		 * 先に手で足した案件が、後からメールで取り込まれても増えない）。返り値は案件を作ったか
		 */
		async recordProject(
			mail: ImportedMailMeta,
			project: ParsedProject,
			at: Date,
		): Promise<'created' | 'existing'> {
			return db.transaction(async (tx) => {
				await tx.insert(importedMails).values({ ...mail, result: 'project', processedAt: at });
				const existing = await tx
					.select({ id: projects.id, importedMailId: projects.importedMailId })
					.from(projects)
					.where(inArray(projects.projectNo, [project.projectNo]))
					.limit(1);
				if (existing[0]) {
					if (existing[0].importedMailId === null) {
						await tx
							.update(projects)
							.set({ importedMailId: mail.id, updatedAt: at })
							.where(inArray(projects.id, [existing[0].id]));
					}
					return 'existing';
				}
				await tx.insert(projects).values({
					projectNo: project.projectNo,
					serviceDate: project.serviceDate,
					venueCode: project.venueCode,
					venueName: project.venueName,
					coupleName: project.coupleName,
					source: 'mail',
					importedMailId: mail.id,
					createdAt: at,
					updatedAt: at,
				});
				return 'created';
			});
		},
	};
}

export type ImportedMailsRepository = ReturnType<typeof createImportedMailsRepository>;

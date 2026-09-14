import { AppError } from '../domain/app-error.js';
import type { Attention, AttentionKind } from '../domain/attention.js';
import type { AttentionsRepository } from '../repositories/attentions.js';

// 要確認事項（F-33 / F-34）。一覧と確認済み。積むのはアプリ自身で、同期・記録・提出・cron の
// services がここの record を呼ぶ（06-error-handling.md 3.1）
export function createAttentionsService(repository: AttentionsRepository) {
	return {
		list(onlyUnchecked: boolean): Promise<Attention[]> {
			return repository.list(onlyUnchecked);
		},

		async check(id: number, now: Date): Promise<Attention> {
			const found = await repository.findById(id);
			if (found === null) throw new AppError('NOT_FOUND');
			if (found.checkedAt !== null) return found;
			await repository.check(id, now);
			return { ...found, checkedAt: now };
		},

		/** 起きたことを残す。文面は呼び出し側が組み立て、識別子を入れない（06-error-handling.md 4.2） */
		record(kind: AttentionKind, detail: string, occurredAt: Date = new Date()): Promise<Attention> {
			return repository.add(kind, detail, occurredAt);
		},
	};
}

export type AttentionsService = ReturnType<typeof createAttentionsService>;

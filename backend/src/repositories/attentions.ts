import { and, count, desc, eq, isNull } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { attentions } from '../db/schema.js';
import type { Attention, AttentionKind } from '../domain/attention.js';

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
export function createAttentionsRepository(db: Database) {
	const columns = {
		id: attentions.id,
		kind: attentions.kind,
		detail: attentions.detail,
		occurredAt: attentions.occurredAt,
		checkedAt: attentions.checkedAt,
	};

	return {
		// 新しいものが上。未確認だけに絞れる（04-api.md 4.9 の ?checked=false）
		async list(onlyUnchecked: boolean): Promise<Attention[]> {
			return db
				.select(columns)
				.from(attentions)
				.where(onlyUnchecked ? isNull(attentions.checkedAt) : undefined)
				.orderBy(desc(attentions.occurredAt), desc(attentions.id));
		},

		async findById(id: number): Promise<Attention | null> {
			const rows = await db.select(columns).from(attentions).where(eq(attentions.id, id)).limit(1);
			return rows[0] ?? null;
		},

		// ホームの件数（02-screens.md 3.2）。未確認だけを数える
		async countUnchecked(): Promise<number> {
			const rows = await db
				.select({ count: count() })
				.from(attentions)
				.where(isNull(attentions.checkedAt));
			return rows[0]?.count ?? 0;
		},

		// 重複を除かない（06-error-handling.md 3.3）。同じことが2回起きれば2行になる
		async add(kind: AttentionKind, detail: string, occurredAt: Date): Promise<Attention> {
			const [row] = await db
				.insert(attentions)
				.values({ kind, detail, occurredAt, checkedAt: null })
				.$returningId();
			if (!row) throw new Error('attentions の insert が id を返さなかった');
			return { id: row.id, kind, detail, occurredAt, checkedAt: null };
		},

		// 確認済みにする（F-34）。未確認へ戻す操作は持たない。既に確認済みなら触らない
		async check(id: number, at: Date): Promise<void> {
			await db
				.update(attentions)
				.set({ checkedAt: at })
				.where(and(eq(attentions.id, id), isNull(attentions.checkedAt)));
		},
	};
}

export type AttentionsRepository = ReturnType<typeof createAttentionsRepository>;

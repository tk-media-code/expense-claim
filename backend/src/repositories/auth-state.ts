import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { authState } from '../db/schema.js';
import type { AuthState } from '../domain/auth-state.js';

// auth_state は単一行（03-database.md 5.3。CHECK (id = 1) で2行目を弾く）。
const SINGLE_ROW_ID = 1;

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 行が無ければ「失効なし」。初期データを投入せず、最初の失効で行ができる（sync_state と同じ形）
export function createAuthStateRepository(db: Database) {
	return {
		async find(): Promise<AuthState> {
			const rows = await db
				.select({ sessionsValidAfter: authState.sessionsValidAfter })
				.from(authState)
				.where(eq(authState.id, SINGLE_ROW_ID))
				.limit(1);
			return { sessionsValidAfter: rows[0]?.sessionsValidAfter ?? null };
		},

		// 全端末のセッションを失効させる（04-api.md 4.1）。次のリクエストで、すべての Cookie が 401 になる
		async invalidateSessionsBefore(at: Date): Promise<void> {
			const values = { id: SINGLE_ROW_ID, sessionsValidAfter: at, updatedAt: at };
			await db.insert(authState).values(values).onDuplicateKeyUpdate({ set: values });
		},
	};
}

export type AuthStateRepository = ReturnType<typeof createAuthStateRepository>;

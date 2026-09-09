import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { syncState } from '../db/schema.js';
import type { SyncState } from '../domain/sync-state.js';

// sync_state は単一行（03-database.md 5.3。CHECK (id = 1) で2行目を弾く）。
const SINGLE_ROW_ID = 1;

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 呼び出し側が受け取るのは domain の型だけである。
export function createSyncStateRepository(db: Database) {
	return {
		async find(): Promise<SyncState | null> {
			const rows = await db
				.select()
				.from(syncState)
				.where(eq(syncState.id, SINGLE_ROW_ID))
				.limit(1);
			const row = rows[0];
			if (!row) return null;
			return {
				lastImportedAt: row.lastImportedAt,
				lastSeenTargetMonth: row.lastSeenTargetMonth,
				lastAlertSentOn: row.lastAlertSentOn,
				lastCronRunAt: row.lastCronRunAt,
				updatedAt: row.updatedAt,
			};
		},

		async save(state: SyncState): Promise<void> {
			const values = {
				id: SINGLE_ROW_ID,
				lastImportedAt: state.lastImportedAt,
				lastSeenTargetMonth: state.lastSeenTargetMonth,
				lastAlertSentOn: state.lastAlertSentOn,
				lastCronRunAt: state.lastCronRunAt,
				updatedAt: state.updatedAt,
			};
			await db.insert(syncState).values(values).onDuplicateKeyUpdate({ set: values });
		},
	};
}

export type SyncStateRepository = ReturnType<typeof createSyncStateRepository>;

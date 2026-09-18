import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { googleCredentials } from '../db/schema.js';
import { scopeNamesOf, type ScopeName } from '../domain/google-authorization.js';

// google_credentials は単一行（03-database.md 5.3。CHECK (id = 1) で2行目を弾く）。
const SINGLE_ROW_ID = 1;

/** 暗号化済みのトークンと、そのスコープ。復号は integrations だけが行う（NF-05） */
export type StoredCredentials = {
	refreshTokenEncrypted: Uint8Array;
	scopes: ScopeName[];
	authorizedAt: Date;
};

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
export function createGoogleCredentialsRepository(db: Database) {
	return {
		async find(): Promise<StoredCredentials | null> {
			const rows = await db
				.select()
				.from(googleCredentials)
				.where(eq(googleCredentials.id, SINGLE_ROW_ID))
				.limit(1);
			const row = rows[0];
			if (!row) return null;
			return {
				refreshTokenEncrypted: row.refreshTokenEncrypted,
				scopes: scopeNamesOf(row.scopes.split(' ')),
				authorizedAt: row.authorizedAt,
			};
		},

		// 初回の認可で作り、再認可で上書きする。リフレッシュトークンは再発行されうる（01-architecture.md 7.2）
		async save(input: {
			refreshTokenEncrypted: Uint8Array;
			scopeUrls: string[];
			authorizedAt: Date;
		}): Promise<void> {
			const values = {
				id: SINGLE_ROW_ID,
				refreshTokenEncrypted: input.refreshTokenEncrypted,
				scopes: input.scopeUrls.join(' '),
				authorizedAt: input.authorizedAt,
				updatedAt: input.authorizedAt,
			};
			await db.insert(googleCredentials).values(values).onDuplicateKeyUpdate({ set: values });
		},

		// tokens イベントで新しいリフレッシュトークンが降ってきたときの更新（05-integration.md 2.3）。
		// スコープと認可日時は変えない
		async replaceToken(refreshTokenEncrypted: Uint8Array, at: Date): Promise<void> {
			await db
				.update(googleCredentials)
				.set({ refreshTokenEncrypted, updatedAt: at })
				.where(eq(googleCredentials.id, SINGLE_ROW_ID));
		},
	};
}

export type GoogleCredentialsRepository = ReturnType<typeof createGoogleCredentialsRepository>;

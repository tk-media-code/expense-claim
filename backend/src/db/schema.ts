import { sql } from 'drizzle-orm';
import {
	check,
	date,
	datetime,
	int,
	mysqlTable,
	tinyint,
	unique,
	varchar,
} from 'drizzle-orm/mysql-core';

// テーブルは実装計画の順に足す（docs/implementation-plan.md）。
// 列の型・NULL・既定値・制約は 03-database.md 5章の表に合わせる。

// 同期状態（単一行）。03-database.md 5.3
export const syncState = mysqlTable(
	'sync_state',
	{
		id: tinyint('id', { unsigned: true }).notNull().default(1).primaryKey(),
		// 最後に取り込んだ日時。取り込みが 0 件だった実行でも更新する（03-database.md 5.3）
		lastImportedAt: datetime('last_imported_at'),
		// 最後に読んだ提出シートの月度。DATE は文字列で扱う（4.2。Date を経由すると 1 日ずれる）
		lastSeenTargetMonth: date('last_seen_target_month', { mode: 'string' }),
		lastAlertSentOn: date('last_alert_sent_on', { mode: 'string' }),
		// cron の死活。送信と無関係に毎日更新する（06-error-handling.md 7章）
		lastCronRunAt: datetime('last_cron_run_at'),
		updatedAt: datetime('updated_at').notNull(),
	},
	(t) => [
		check('sync_state_single_row', sql`${t.id} = 1`),
		// 提出シートの A1 は月初の日付を返す（要求分析 5.6）
		check(
			'sync_state_target_month_is_first_day',
			sql`${t.lastSeenTargetMonth} is null or dayofmonth(${t.lastSeenTargetMonth}) = 1`,
		),
	],
);

// 駅。設定データで、消えない（03-database.md 5.1 / 6.1）
//
// 照合順序は列に付けない（Drizzle の MySQL 方言に collate の指定が無い）。スキーマの既定
// utf8mb4_ja_0900_as_cs を継ぐ。MySQL 既定の ai_ci だと「か」と「が」が同じ値になり、
// UNIQUE (name) が濁点違いの別の駅を弾いてしまう（4.1）。
export const stations = mysqlTable(
	'stations',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 鉄道会社の略称込み（F-15）。X鉄乙駅 と Y鉄乙駅 は別の行
		name: varchar('name', { length: 100 }).notNull(),
		// DB 既定値を持たせない。コンテナの TZ が Asia/Tokyo なので CURRENT_TIMESTAMP は
		// JST になる。アプリが UTC で入れる（4.2）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	(t) => [unique('stations_name_unique').on(t.name)],
);

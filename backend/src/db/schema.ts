import { sql } from 'drizzle-orm';
import { check, date, datetime, mysqlTable, tinyint } from 'drizzle-orm/mysql-core';

// 同期状態（単一行）。03-database.md 5.3
//
// 15 テーブルはまだ書いていない。ここにあるのは、マイグレーションの生成と適用、
// および実 MySQL に当てたテストが通ることを確かめるための 1 本である（Issue #75）。
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

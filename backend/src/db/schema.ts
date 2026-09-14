import { sql } from 'drizzle-orm';
import {
	check,
	date,
	datetime,
	int,
	mysqlEnum,
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

// 区間。設定データで、消えない（03-database.md 5.1 / 6.1）
//
// 複数のルートで共有し、片道運賃はここに1つだけ持つ（決定18）。運賃改定はこの行を直せば
// 使っている全ルートに効く。逆向きの区間は登録しない（決定9）。復路は同じ区間を逆順にし、
// 出発駅と到着駅を入れ替えて使う。
export const segments = mysqlTable(
	'segments',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 使っている駅は消せない（6.2 RESTRICT / 決定22）。1-4 の削除 API はこれを 409 に写す
		fromStationId: int('from_station_id', { unsigned: true })
			.notNull()
			.references(() => stations.id, { onDelete: 'restrict' }),
		toStationId: int('to_station_id', { unsigned: true })
			.notNull()
			.references(() => stations.id, { onDelete: 'restrict' }),
		// 片道運賃。UNSIGNED で負の額を DB でも弾く（4.4。一枚目の網はアプリ／N-09）
		oneWayFare: int('one_way_fare', { unsigned: true }).notNull(),
		// DB 既定値を持たせない。アプリが UTC で入れる（4.2。stations と同じ）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	(t) => [
		// 同じ駅ペアに運賃を2つ持たせない（5.1 / 決定18）
		unique('segments_from_station_id_to_station_id_unique').on(t.fromStationId, t.toStationId),
		// 出発駅と到着駅が同じ区間は作れない（5.1）
		check('segments_from_to_differ', sql`${t.fromStationId} <> ${t.toStationId}`),
	],
);

// 会場。設定データで、消えない（03-database.md 5.1 / 6.1）
//
// 空で始め、会場マスタの取り込み（F-13 / 8-2）が code を鍵に upsert で入れる（10.3）。
// 手で足した会場（F-14）は source = 'manual' で持ち、取り込みで触らない。毎回入れ直すと
// 巻き込んで消しかねないためである。削除する API は持たない（04-api.md 7章）。
export const venues = mysqlTable(
	'venues',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 会場コード。3文字前後の英数字。案件はこの文字列で会場を指し、外部キーではない（8章）
		code: varchar('code', { length: 16 }).notNull(),
		name: varchar('name', { length: 255 }).notNull(),
		// マスタ由来（F-13）／自分で追加（F-14）。API から受け取らない（04-api.md 7章）
		source: mysqlEnum('source', ['master', 'manual']).notNull(),
		// DB 既定値を持たせない。アプリが UTC で入れる（4.2。stations と同じ）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	// 取り込みの upsert が鍵にする（5.1）
	(t) => [unique('venues_code_unique').on(t.code)],
);

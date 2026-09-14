import { sql } from 'drizzle-orm';
import {
	check,
	date,
	datetime,
	index,
	int,
	mysqlEnum,
	mysqlTable,
	smallint,
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

// ルート。設定データで、消えない（03-database.md 5.1 / 6.1）
//
// 会場1対多ルート（要件定義 6.1 / R-07）。「自宅→会場」の1方向で持ち（決定9）、復路は区間の
// 並びを逆順にして使う。ルートまで多対多にしない。1本を消しただけで複数の会場から行き方が
// 消えるからで、同じ経路でも会場ごとに1本ずつ登録する（決定18）。
export const routes = mysqlTable(
	'routes',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 設定データを巻き込みで消さない（6.2 RESTRICT）。会場を削除する API はそもそも無い
		venueId: int('venue_id', { unsigned: true })
			.notNull()
			.references(() => venues.id, { onDelete: 'restrict' }),
		// 「乙駅乗換」など
		name: varchar('name', { length: 100 }).notNull(),
		// DB 既定値を持たせない。アプリが UTC で入れる（4.2。stations と同じ）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	// 同じ会場に同じ名前のルートを2本持たせない（5.1）。別の会場なら同じ名前でよい
	(t) => [unique('routes_venue_id_name_unique').on(t.venueId, t.name)],
);

// ルートが使う区間の並び。設定データで、消えない（03-database.md 5.1 / 6.1）
//
// segments を独立させた時点でルートと区間は多対多になり、その結び付きを置く場所である。
// 「ルートが何番目にどの区間を使うか」だけを持ち、区間そのもの（駅・運賃）は持たない。
// 上限を設けない（要件定義 6.1）。乗り換え無しなら1行、1回なら2行、2回なら3行。
export const routeSegments = mysqlTable(
	'route_segments',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 並びはルートの部品。ルートを消せば並びも消えるが、区間そのものは消えない（6.2 CASCADE）
		routeId: int('route_id', { unsigned: true })
			.notNull()
			.references(() => routes.id, { onDelete: 'cascade' }),
		// ルート内の順序。1 始まり。API の segmentIds の配列順からサーバーが振る（04-api.md 3.2）
		sortOrder: smallint('sort_order', { unsigned: true }).notNull(),
		// 使われている区間は消せない（6.2 RESTRICT / 決定22）。1-7 の削除 API はこれを 409 に写す
		segmentId: int('segment_id', { unsigned: true })
			.notNull()
			.references(() => segments.id, { onDelete: 'restrict' }),
		// DB 既定値を持たせない。アプリが UTC で入れる（4.2。stations と同じ）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	// 順序を持つ子は (親, sort_order) を UNIQUE にする（4.3）。
	// UNIQUE (route_id, segment_id) は張らない。想定していない経路を DB が先に禁じることになり、
	// 「上限を設けない」「名寄せをしない」と同じ理由で設定データを機械が狭めにいかない（5.1）
	(t) => [unique('route_segments_route_id_sort_order_unique').on(t.routeId, t.sortOrder)],
);

// 案件。実績データで、月度切替で消える（03-database.md 5.2 / 6.1）。
//
// 月度の列を持たない（9章）。施行日から導出し、範囲検索で引く。持たせると施行日を直したときに
// 月度が置き去りになる。会場コードは venues.code を指す外部キーにしない（8章）。マスタに無い
// コードの案件が実際に来ており、外部キーにすると取り込めなくなる。会場名を持つのも同じ理由で、
// マスタに無い会場は venues に名前が無い。取り込み元メール（imported_mail_id）は 9-1 で足す。
export const projects = mysqlTable(
	'projects',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 案件番号。手で足した案件も必ず持つ（F-10）。数字9桁だが識別子であって数値ではない（4.3）
		projectNo: varchar('project_no', { length: 32 }).notNull(),
		// 施行日。DATE は文字列で扱う（4.2。Date を経由すると 1 日ずれ、決定12 を壊す）
		serviceDate: date('service_date', { mode: 'string' }).notNull(),
		venueCode: varchar('venue_code', { length: 16 }).notNull(),
		venueName: varchar('venue_name', { length: 255 }).notNull(),
		// ご両家名。〇〇様△△様 の形
		coupleName: varchar('couple_name', { length: 255 }).notNull(),
		// 自動取込／手動追加。API から受け取らない（04-api.md 7章）
		source: mysqlEnum('source', ['mail', 'manual']).notNull(),
		// DB 既定値を持たせない。アプリが UTC で入れる（4.2。stations と同じ）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	(t) => [
		// 二重取り込みの一段目（F-08）。NOT NULL なので例外なく効く
		unique('projects_project_no_unique').on(t.projectNo),
		// 月度での絞り込みと並び順（9.1）
		index('projects_service_date_index').on(t.serviceDate),
	],
);

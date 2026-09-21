import { sql } from 'drizzle-orm';
import {
	check,
	customType,
	date,
	datetime,
	index,
	int,
	mysqlEnum,
	mysqlTable,
	smallint,
	text,
	tinyint,
	unique,
	varchar,
} from 'drizzle-orm/mysql-core';

// Drizzle の varbinary は TypeScript 側が string で、バイト列をそのまま往復できない。
// 暗号化したトークンは Buffer で読み書きしたいので、列の型だけ自分で決める
const binary = customType<{ data: Uint8Array; driverData: Buffer }>({
	dataType: () => 'varbinary(1024)',
	toDriver: (value) => Buffer.from(value),
	fromDriver: (value) => new Uint8Array(value),
});

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

// 取り込み済みメール。システムデータ（03-database.md 5.3）。主キーは Gmail の message id。
//
// 案件を手で削除しても行は残す（要件定義 6.3）。残さないと次に開いたときに同じ案件がまた入ってくる。
// result に「依頼無しで除外」「依頼以外のメール」「解析に失敗」を持つのは、次回に飛ばすため。解析に失敗した
// メールを毎回読み直しても、同じ失敗を繰り返して要確認事項が増えるだけになる。同じ差出人から給与明細のような
// 依頼以外のメールも届き（2026-09-18 実測）、それは unrelated として記録だけする（決定23）
export const importedMails = mysqlTable(
	'imported_mails',
	{
		id: varchar('id', { length: 64 }).primaryKey(),
		threadId: varchar('thread_id', { length: 64 }),
		result: mysqlEnum('result', ['project', 'no_request', 'unrelated', 'parse_failed']).notNull(),
		// Gmail の internalDate。UTC
		internalDate: datetime('internal_date'),
		processedAt: datetime('processed_at').notNull(),
	},
	(t) => [index('imported_mails_processed_at_index').on(t.processedAt)],
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
		// 取り込み元メール。手動追加では NULL。そもそもメールを消さないので RESTRICT（6.2）
		importedMailId: varchar('imported_mail_id', { length: 64 }).references(() => importedMails.id, {
			onDelete: 'restrict',
		}),
		// DB 既定値を持たせない。アプリが UTC で入れる（4.2。stations と同じ）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	(t) => [
		// 二重取り込みの一段目（F-08）。NOT NULL なので例外なく効く
		unique('projects_project_no_unique').on(t.projectNo),
		// 1通の案件詳細メールは1案件になる（要求分析 6.3）。NULL は重複してよい
		unique('projects_imported_mail_id_unique').on(t.importedMailId),
		// 月度での絞り込みと並び順（9.1）
		index('projects_service_date_index').on(t.serviceDate),
	],
);

// 交通費記録。実績データで、月度切替で消える（03-database.md 5.2 / 6.1）。
//
// ルートへの2本の外部キーは提出に使わない。「どのルートで行ったか」を画面に出すためだけに持ち、
// ルートが消えても実績は自立している（SET NULL / 7章）。提出行は expense_record_legs から作る。
// trip_type は区間側に持たせない。案件の中で往復と片道は混ざらない（要件定義 5.3）。
export const expenseRecords = mysqlTable(
	'expense_records',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 案件を消せば記録も消える（6.2 CASCADE / F-12）
		projectId: int('project_id', { unsigned: true })
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		// 提出シートの G列。全行に同じ値を書く
		tripType: mysqlEnum('trip_type', ['round', 'one_way']).notNull(),
		// 表示用。ルートは実績より長く生きるが、消えても実績は残る（6.2 SET NULL）
		outboundRouteId: int('outbound_route_id', { unsigned: true }).references(() => routes.id, {
			onDelete: 'set null',
		}),
		returnRouteId: int('return_route_id', { unsigned: true }).references(() => routes.id, {
			onDelete: 'set null',
		}),
		// 記録した日時。UTC
		recordedAt: datetime('recorded_at').notNull(),
		// DB 既定値を持たせない。アプリが UTC で入れる（4.2。stations と同じ）
		createdAt: datetime('created_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	// 案件1対 0..1（要件定義 6.2）。1案件に交通費記録が2件できない（4.4）
	(t) => [unique('expense_records_project_id_unique').on(t.projectId)],
);

// 提出行の正本（03-database.md 5.2 / 7章）。提出シートの1行に1行で対応する。
//
// 駅名は記録時点の文字列で持ち、駅への外部キーではない。金額は往復なら ×2、復路は反転を
// 記録時に済ませてあり、H列へ無加工で書ける値である。ルートを直しても消しても過去の記録は動かない。
// 作成・更新日時は持たない。行は記録の部品で、記録の側の recorded_at で足りる（5.2 の表どおり）
export const expenseRecordLegs = mysqlTable(
	'expense_record_legs',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 区間の行は記録の部品（6.2 CASCADE）
		expenseRecordId: int('expense_record_id', { unsigned: true })
			.notNull()
			.references(() => expenseRecords.id, { onDelete: 'cascade' }),
		// 提出シートに書く順。1 始まり
		sortOrder: smallint('sort_order', { unsigned: true }).notNull(),
		// E列・F列。記録時点の駅名
		fromStationName: varchar('from_station_name', { length: 100 }).notNull(),
		toStationName: varchar('to_station_name', { length: 100 }).notNull(),
		// H列。そのまま書く額。UNSIGNED で負の額を DB でも弾く（4.4）
		amount: int('amount', { unsigned: true }).notNull(),
	},
	// 順序を持つ子は (親, sort_order) を UNIQUE にする（4.3）
	(t) => [
		unique('expense_record_legs_expense_record_id_sort_order_unique').on(
			t.expenseRecordId,
			t.sortOrder,
		),
	],
);

// セッション失効の基準（単一行）。03-database.md 5.3 / 04-api.md 4.1。
//
// 署名付き Cookie はサーバー側に状態を持たない。端末ごとの行ではなく「失効の基準時刻」を1つだけ持ち、
// POST /api/auth/logout-all がここに現在時刻を書く。発行時刻がそれより前の Cookie は次のリクエストで
// 弾かれる。google_credentials（Google API の認可）とは別の行にし、ログインと API の認可を混ぜない。
export const authState = mysqlTable(
	'auth_state',
	{
		id: tinyint('id', { unsigned: true }).notNull().default(1).primaryKey(),
		// ここより前に発行された Cookie を弾く。NULL なら失効なし。UTC
		sessionsValidAfter: datetime('sessions_valid_after'),
		updatedAt: datetime('updated_at').notNull(),
	},
	(t) => [check('auth_state_single_row', sql`${t.id} = 1`)],
);

// Google API の認可情報（単一行）。03-database.md 5.3 / 01-architecture.md 7.2。
//
// リフレッシュトークンは暗号化して保存し、暗号鍵は環境変数で持つ。列に鍵は入れない。
// アクセストークンは保存しない。寿命が短く、リフレッシュトークンから作り直せる。置かなければ漏れない。
// 初期データは投入できない（refresh_token_encrypted が NOT NULL）。初回の認可で作られる。
export const googleCredentials = mysqlTable(
	'google_credentials',
	{
		id: tinyint('id', { unsigned: true }).notNull().default(1).primaryKey(),
		// AES-256-GCM の iv + 暗号文 + タグ（integrations/google/credentials.ts）
		refreshTokenEncrypted: binary('refresh_token_encrypted').notNull(),
		// 付与済みスコープ。空白区切り。増えたときに再認可へ導く（F-02）
		scopes: varchar('scopes', { length: 512 }).notNull(),
		authorizedAt: datetime('authorized_at').notNull(),
		updatedAt: datetime('updated_at').notNull(),
	},
	(t) => [check('google_credentials_single_row', sql`${t.id} = 1`)],
);

// 要確認事項。システムデータ（03-database.md 5.3）。どこにも繋がない（3章）。
//
// アプリが起こしたことの記録で、外から積むエンドポイントを持たない（04-api.md 4.9）。
// 確認済みの行を消さない。未確認だけを数えればホームの見え方は同じで、いつ何が起きたかを後から読める。
// detail は本人が読む日本語の文面1つで、構造を持たせない（06-error-handling.md 4章）。識別子を入れない
export const attentions = mysqlTable(
	'attentions',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 6種（06-error-handling.md 3.1）。種別を足すときは画面の表も一緒に足す
		kind: mysqlEnum('kind', [
			'mail_parse_failed',
			'venue_code_unknown',
			'sheet_unreachable',
			'drive_upload_failed',
			'rows_inserted',
			'alert_send_failed',
		]).notNull(),
		detail: text('detail').notNull(),
		// 発生日時。UTC
		occurredAt: datetime('occurred_at').notNull(),
		// NULL なら未確認（F-34）
		checkedAt: datetime('checked_at'),
	},
	// ホームの件数は「未確認のもの」だけを数える（02-screens.md 3.2）
	(t) => [index('attentions_checked_at_occurred_at_index').on(t.checkedAt, t.occurredAt)],
);

// タクシー乗車。実績データで、月度切替で消える（03-database.md 5.2 / 6.1）。
//
// 1回ずつ持つ（F-22 / R-12）。1日に複数回乗ることがある。提出シートの I列には案件ごとに合算した額を書き、
// 領収書の URL は乗車ごとに並べる。乗車の数と行の数は一致しない。
// expense_records の子ではなく projects にぶら下がる。乗車は交通費記録と独立している（04-api.md 4.6）
export const taxiRides = mysqlTable(
	'taxi_rides',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 案件を消せば乗車も消える（6.2 CASCADE）
		projectId: int('project_id', { unsigned: true })
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		// 乗車日。DATE は文字列で扱う（4.2）
		rodeOn: date('rode_on', { mode: 'string' }).notNull(),
		// この1回の金額。UNSIGNED で負の額を DB でも弾く（4.4）
		amount: int('amount', { unsigned: true }).notNull(),
		createdAt: datetime('created_at').notNull(),
	},
	(t) => [index('taxi_rides_project_id_index').on(t.projectId)],
);

// 領収書。実績データ（03-database.md 5.2）。乗車1回につき1件（R-12）。
//
// URL を持つのは組み立て直さないため。ファイルIDから復元する作りにすると、ドライブの URL 書式が
// 変わったときに過去に提出した URL と食い違う。ファイル名はアプリが付ける（<YYYYMMDD>_<会場コード>_<連番>）。
// ドライブ上のファイル実体はアプリから消さない。行が消えてもファイルは残る（要件定義 6.4）
export const receipts = mysqlTable(
	'receipts',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 乗車が消えれば領収書の行も消える（6.2 CASCADE）。ファイル実体は消えない
		taxiRideId: int('taxi_ride_id', { unsigned: true })
			.notNull()
			.references(() => taxiRides.id, { onDelete: 'cascade' }),
		driveFileId: varchar('drive_file_id', { length: 128 }).notNull(),
		// 提出シートの M列へ書く URL（R-15）
		driveUrl: varchar('drive_url', { length: 512 }).notNull(),
		fileName: varchar('file_name', { length: 255 }).notNull(),
		// 画像または PDF（R-13）
		mimeType: varchar('mime_type', { length: 100 }).notNull(),
		storedAt: datetime('stored_at').notNull(),
	},
	// 乗車1回につき1件（R-12）。1乗車に領収書が2件できない（4.4）
	(t) => [unique('receipts_taxi_ride_id_unique').on(t.taxiRideId)],
);

// 提出記録。実績データだが月度切替で消さない（03-database.md 6.1）。
//
// 提出は何度でも実行できる（F-29）ので月度ごとに複数行になる。「提出済みか」は行の有無で、
// 「いつ提出したか」は最新の executed_at で決まる。消すと「提出したから消した」という判断の根拠が
// 判断と同時に失われる。行を挿入したことはここに持たず、要確認事項に残す
export const submissions = mysqlTable(
	'submissions',
	{
		id: int('id', { unsigned: true }).autoincrement().primaryKey(),
		// 対象月度。月初のみ（CHECK）。DATE は文字列で扱う（4.2）
		targetMonth: date('target_month', { mode: 'string' }).notNull(),
		executedAt: datetime('executed_at').notNull(),
		writtenRows: smallint('written_rows', { unsigned: true }).notNull(),
	},
	(t) => [
		index('submissions_target_month_executed_at_index').on(t.targetMonth, t.executedAt),
		check('submissions_target_month_is_first_day', sql`dayofmonth(${t.targetMonth}) = 1`),
	],
);

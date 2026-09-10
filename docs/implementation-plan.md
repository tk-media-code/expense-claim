# 実装計画

全74タスクの一覧と進捗。**次に着手するのは、上から最初の `⬜`。**
状態は `⬜ 未着手` / `✅ 完了` / `⏸ 保留`。

## 進捗

| Phase | 内容 | 終わると何ができるか | 進捗 |
| --- | --- | --- | --- |
| [0](#phase-0--共通の足場) | 共通の足場 | エラーの形と API クライアントが揃う | `░░░░░░░░░░` 0/3 |
| [1](#phase-1--駅と区間) | 駅と区間 | 駅と区間を登録し、片道運賃を持てる | `░░░░░░░░░░` 0/8 |
| [2](#phase-2--会場とルート) | 会場とルート | 区間を並べてルートにし、会場へ紐付けられる | `░░░░░░░░░░` 0/7 |
| [3](#phase-3--案件とホーム) | 案件とホーム | 案件を手で足し、月度ごとの一覧が見られる | `░░░░░░░░░░` 0/8 |
| [4](#phase-4--交通費の記録) | 交通費の記録 | **「帰り道の2手」が通る** | `░░░░░░░░░░` 0/6 |
| [5](#phase-5--認証) | 認証 | 本人だけが使える | `░░░░░░░░░░` 0/6 |
| [6](#phase-6--google-api-の認可) | Google API の認可 | Gmail / ドライブ / シートを叩ける | `░░░░░░░░░░` 0/5 |
| [7](#phase-7--要確認事項) | 要確認事項 | 失敗を記録して見せられる | `░░░░░░░░░░` 0/3 |
| [8](#phase-8--スプレッドシートを読む) | スプレッドシートを読む | 会場マスタと対象月度が入る | `░░░░░░░░░░` 0/4 |
| [9](#phase-9--gmail-の取り込み) | Gmail の取り込み | 案件が自動で入ってくる | `░░░░░░░░░░` 0/5 |
| [10](#phase-10--タクシーと領収書) | タクシーと領収書 | 領収書がドライブへ入る | `░░░░░░░░░░` 0/5 |
| [11](#phase-11--提出) | 提出 | **提出シートへ書き込める** | `░░░░░░░░░░` 0/9 |
| [12](#phase-12--提出アラートと設定の控え) | 提出アラートと設定の控え | 忘れても知らせが来る | `░░░░░░░░░░` 0/5 |
| | **合計** | | **0/74** |

## タスク一覧

`#` は `<Phase>-<連番>`。**上から順に着手する。** `層` は `DB` / `BE` / `FE` / `E2E` / `基盤`。

### Phase 0 — 共通の足場

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 0-1 | API の共通エラー形式と `app.onError` を作る | BE | [`04-api.md`](design/04-api.md) 2.5 | — | ⬜ |
| 0-2 | フロントの API クライアントと、失敗をトーストで出す共通処理を作る | FE | [`06-error-handling.md`](design/06-error-handling.md) 5章 | — | ⬜ |
| 0-3 | 画面のルーティングとナビゲーションの骨格を作る | FE | [`02-screens.md`](design/02-screens.md) 2.1 | — | ⬜ |

### Phase 1 — 駅と区間

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 1-1 | `stations` テーブルを作る | DB | F-15 | — | ⬜ |
| 1-2 | `segments` テーブルを作る | DB | F-37 | — | ⬜ |
| 1-3 | 駅の一覧・登録 API | BE | F-15 | — | ⬜ |
| 1-4 | 駅の編集・削除 API（**使用中の削除は 409**） | BE | F-15 / 決定22 | — | ⬜ |
| 1-5 | 「区間と運賃」画面の `駅` タブ | FE | [`02-screens.md`](design/02-screens.md) 3.8 | — | ⬜ |
| 1-6 | 区間の一覧・登録 API（使用ルート数を含める） | BE | F-37 | — | ⬜ |
| 1-7 | 区間の編集・削除 API（**駅の差し替えは未使用時のみ**） | BE | F-37 / 決定22 | — | ⬜ |
| 1-8 | 「区間と運賃」画面の `区間` タブ | FE | [`02-screens.md`](design/02-screens.md) 3.8 | — | ⬜ |

### Phase 2 — 会場とルート

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 2-1 | `venues` テーブルを作る | DB | F-13 / F-14 | — | ⬜ |
| 2-2 | `routes` と `route_segments` テーブルを作る | DB | F-16 / F-17 | — | ⬜ |
| 2-3 | 会場の一覧・追加 API（**紐づくルートまで返す**） | BE | F-14 / F-17 | — | ⬜ |
| 2-4 | ルートの登録・取得 API（`segmentIds` の並び） | BE | F-16 | — | ⬜ |
| 2-5 | ルートの更新・削除 API | BE | F-16 | — | ⬜ |
| 2-6 | 「会場とルート」画面（一覧・絞り込み・会場の追加） | FE | F-38 / [`02-screens.md`](design/02-screens.md) 3.6 | — | ⬜ |
| 2-7 | 「ルートの編集」画面（区間を並べる） | FE | [`02-screens.md`](design/02-screens.md) 3.7 | — | ⬜ |

### Phase 3 — 案件とホーム

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 3-1 | 「月」の3基準を型で分ける（`domain/month.ts`） | BE | [`01-architecture.md`](design/01-architecture.md) 5.4 | — | ⬜ |
| 3-2 | `projects` テーブルを作る | DB | F-10 | — | ⬜ |
| 3-3 | 案件の追加・詳細 API（**`source` は `manual` 固定**） | BE | F-10 / F-11 | — | ⬜ |
| 3-4 | 案件の修正・削除 API | BE | F-11 / F-12 | — | ⬜ |
| 3-5 | `GET /api/home`（月度ごとの案件一覧。**Phase 4・7・11 で育つ**） | BE | F-09 | — | ⬜ |
| 3-6 | ホーム画面（月度ごとの案件カード） | FE | [`02-screens.md`](design/02-screens.md) 3.2 | — | ⬜ |
| 3-7 | 「案件の追加」画面 | FE | [`02-screens.md`](design/02-screens.md) 3.4 | — | ⬜ |
| 3-8 | 「案件の詳細」画面（修正・削除） | FE | [`02-screens.md`](design/02-screens.md) 3.3 | — | ⬜ |

### Phase 4 — 交通費の記録

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 4-1 | `expense_records` と `expense_record_legs` テーブルを作る | DB | F-18 / F-20 | — | ⬜ |
| 4-2 | `GET /api/projects/:id/expense-record`（集約。既定値を含む。**Phase 10 で育つ**） | BE | F-18 / F-19 | — | ⬜ |
| 4-3 | `PUT …/expense-record`（**記録時点の運賃と駅名を legs に固定する**） | BE | F-20 / [`03-database.md`](design/03-database.md) 7章 | — | ⬜ |
| 4-4 | 「交通費の記録」画面（ルート選択・往復／片道・保存） | FE | [`02-screens.md`](design/02-screens.md) 3.5 | — | ⬜ |
| 4-5 | ホームと案件詳細に「記録の済み／未」を出す | BE / FE | F-21 | — | ⬜ |
| 4-6 | 「帰り道の2手」を E2E で通す | E2E | [`07-development.md`](design/07-development.md) 4章 | — | ⬜ |

### Phase 5 — 認証

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 5-1 | `auth_state` テーブルを作る | DB | [`03-database.md`](design/03-database.md) 5.3 | — | ⬜ |
| 5-2 | Google OAuth のログイン（`state` + PKCE・**許可アドレス照合**） | BE | F-01 / N-03 | — | ⬜ |
| 5-3 | セッション Cookie と `GET /api/auth/session`（**`sub` と `iat` だけ**・90日） | BE | F-01 / N-18 | — | ⬜ |
| 5-4 | ログアウトと全端末失効（`sessions_valid_after`） | BE | [`04-api.md`](design/04-api.md) 4.1 | — | ⬜ |
| 5-5 | `/api/*` に認証を被せる（`/api/health` だけ除く。**E2E の直し込みを含む**） | BE | NF-06 | — | ⬜ |
| 5-6 | ログイン画面と、未ログインを飛ばす route middleware | FE | [`02-screens.md`](design/02-screens.md) 3.1 | — | ⬜ |

### Phase 6 — Google API の認可

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 6-1 | `google_credentials` テーブルを作る | DB | [`03-database.md`](design/03-database.md) 5.3 | — | ⬜ |
| 6-2 | `integrations` の共通土台（`tools/*-probe/auth.cjs` を移植。**トークンを暗号化保管**） | BE | NF-05 / [`01-architecture.md`](design/01-architecture.md) 7.2 | — | ⬜ |
| 6-3 | 認可フロー（`/api/google/authorization` の3本） | BE | F-02 | — | ⬜ |
| 6-4 | `GET /api/settings`（**名前だけ返す。ID は返さない**） | BE | N-08 | — | ⬜ |
| 6-5 | 「設定」画面（接続の状態・再認可） | FE | [`02-screens.md`](design/02-screens.md) 3.11 | — | ⬜ |

### Phase 7 — 要確認事項

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 7-1 | `attentions` テーブルを作る（`kind` 7種） | DB | F-33 / [`06-error-handling.md`](design/06-error-handling.md) 3章 | — | ⬜ |
| 7-2 | 要確認事項の一覧・確認済み API | BE | F-33 / F-34 | — | ⬜ |
| 7-3 | 「要確認事項」画面と、ホームの未確認件数 | FE | [`02-screens.md`](design/02-screens.md) 3.10 / 4.4 | — | ⬜ |

### Phase 8 — スプレッドシートを読む

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 8-1 | `integrations/sheets` の読む側（**様式の確かめを含む**） | BE | NF-09 / NF-10 | — | ⬜ |
| 8-2 | `POST /api/venues/import`（`code` を鍵に upsert。**`manual` は触らない**） | BE | F-13 | — | ⬜ |
| 8-3 | 対象月度を `A1` から読む | BE | F-31 | — | ⬜ |
| 8-4 | 会場の取り込みボタンと、設定画面の対象月度 | FE | [`02-screens.md`](design/02-screens.md) 3.6 / 3.11 | — | ⬜ |

### Phase 9 — Gmail の取り込み

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 9-1 | `imported_mails` テーブルを作る | DB | F-08 | — | ⬜ |
| 9-2 | メールの解析（`domain/mail-parse.ts`。**先頭4行の裏取り**） | BE | F-06 / F-07 | — | ⬜ |
| 9-3 | `integrations/gmail` の読む側 | BE | F-04 / F-05 | — | ⬜ |
| 9-4 | `POST /api/sync` の取り込み（**失敗は要確認事項へ**。**Phase 11 で育つ**） | BE | F-03〜F-08 | — | ⬜ |
| 9-5 | ホームの「最後に取り込んだ日時」と、手動での取り込み | FE | F-03 / [`06-error-handling.md`](design/06-error-handling.md) 7章 | — | ⬜ |

### Phase 10 — タクシーと領収書

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 10-1 | `taxi_rides` と `receipts` テーブルを作る | DB | F-22 / F-23 | — | ⬜ |
| 10-2 | `integrations/drive`（保存 → 共有の付与） | BE | F-24 / F-25 | — | ⬜ |
| 10-3 | `POST …/taxi-rides`（**失敗したら DB に何も残さない**） | BE | F-26 | — | ⬜ |
| 10-4 | `DELETE /api/taxi-rides/:id`（**ドライブの実体は消さない**） | BE | 要件定義 6.4 | — | ⬜ |
| 10-5 | 記録画面のタクシーと領収書アップロード | FE | [`02-screens.md`](design/02-screens.md) 3.5 | — | ⬜ |

### Phase 11 — 提出

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 11-1 | `submissions` テーブルを作る | DB | F-30 | — | ⬜ |
| 11-2 | 提出行の生成（要件定義 5.2 の手順1〜7） | BE | F-27 / F-28 | — | ⬜ |
| 11-3 | `POST /api/submissions/preview`（**書かない**） | BE | F-27 | — | ⬜ |
| 11-4 | `integrations/sheets` の書く側（**1回の `values.update` に畳む**） | BE | F-28 / [`05-integration.md`](design/05-integration.md) 8章 | — | ⬜ |
| 11-5 | `POST /api/submissions`（**`targetMonth` を照合してから実行**） | BE | F-28〜F-30 | — | ⬜ |
| 11-6 | 「提出」画面（確認 → 実行 → 結果） | FE | [`02-screens.md`](design/02-screens.md) 3.9 | — | ⬜ |
| 11-7 | ホームに提出状態を出す | BE / FE | F-30 | — | ⬜ |
| 11-8 | 月度切替の検知と実績削除を `POST /api/sync` に足す | BE | F-32 / [`03-database.md`](design/03-database.md) 6.3 | — | ⬜ |
| 11-9 | 提出導線を E2E で通す | E2E | [`07-development.md`](design/07-development.md) 4章 | — | ⬜ |

### Phase 12 — 提出アラートと設定の控え

| # | タスク | 層 | 要件 | Issue | 状態 |
| --- | --- | --- | --- | --- | --- |
| 12-1 | `integrations/gmail` の送る側（**宛先は本人固定**） | BE | NF-13 / N-23 | — | ⬜ |
| 12-2 | 提出アラートの判定と送信（1日・3日の朝） | BE | F-35 / F-36 | — | ⬜ |
| 12-3 | cron コンテナを compose に足す | 基盤 | NF-04 / [`01-architecture.md`](design/01-architecture.md) 4.2 | — | ⬜ |
| 12-4 | ホームに cron の死活を出す | FE | [`06-error-handling.md`](design/06-error-handling.md) 7章 | — | ⬜ |
| 12-5 | 設定データの控え（書き出し・読み込み） | BE / FE | NF-11 | — | ⬜ |

## 表の更新

- **実装 PR の中で、その行を書き換える。** 進捗の更新だけのコミットを作らない
- Issue を採番したら `Issue` 列に `#83` の形で入れる
- 実装が終わったら `状態` を `✅` にし、「進捗」の分子・進捗バー・合計を数え直す
- 進捗バーは10目盛り。`round(完了 / 全体 × 10)` だけ `█` を並べ、残りを `░` にする
- タスクを割ったら行を足す。番号は `1-3a` の枝番で、既存の番号は動かさない

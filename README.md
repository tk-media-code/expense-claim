# expense-claim

交通費申請を行うアプリです。

- **要求分析**（なぜ作るのか・何が欲しいのか）: [`docs/requirements-analysis.md`](docs/requirements-analysis.md)
- **要件定義**（いま守る約束）: [`docs/requirements.md`](docs/requirements.md)
- **決定ログ**（なぜ決めたか・なぜ覆したか）: [`docs/decisions.md`](docs/decisions.md)
- **設計**（どう作るか）: [`docs/design/`](docs/design/) — 技術選定・画面・データベース・API・
  外部連携・異常系・開発環境。**[`01-architecture.md`](docs/design/01-architecture.md) から読んでください。**
- **実装計画**（どの順で作るか・いまどこまで進んだか）: [`docs/implementation-plan.md`](docs/implementation-plan.md) —
  全74タスクの一覧と進捗。**次に着手するものは、表の上から最初の `⬜` です。**
- **Google Cloud 入門**: [`docs/google-cloud-basics.md`](docs/google-cloud-basics.md) —
  このアプリで使う範囲の Google Cloud を、**提案の是非を判断できるようになること**を目的に
  まとめています。セットアップ手順もここにあります。
- **提出シート検証ツール**: [`tools/sheet-probe/`](tools/sheet-probe/) — 提出先スプレッドシートへ
  API から読み書きできるかを実機で確かめます。様式が変わったときに再実行してください。
- **依頼メール検証ツール**: [`tools/gmail-probe/`](tools/gmail-probe/) — 依頼メールを Gmail API から
  読み、案件として取り込めるかを実機で確かめます。メールの書式が変わったときに再実行してください。

## 開発環境

Nuxt 4 の SPA と Hono 4 の API を、nginx が同一オリジンで振り分ける。ローカルだけ MySQL 8.4 と CloudBeaver も立つ。

### 日常の開発

```bash
docker compose up
```

`compose.override.yaml` が自動で読まれ、frontend / backend のホットリロード付き開発モードになる。

- アプリ: http://localhost:8080/
- CloudBeaver: http://127.0.0.1:8978/ （初回は管理者と MySQL 接続を画面で作る。ホストは `mysql`、ポート `3306`）

### 本番相当の確認

```bash
docker compose -f compose.yaml up --build
```

nginx イメージが frontend を静的ビルドして配信する。**立つのは nginx と backend だけ**で、
MySQL と CloudBeaver は開発専用なので上がらない（本番のデータベースは RDS）。
DB を触る API を試すときは `DATABASE_URL` を渡す。

### 依存を足したあと

frontend / backend はコンテナ内の名前付きボリュームで `node_modules` を持つ。パッケージを足したら:

```bash
docker compose run --rm frontend npm ci
docker compose run --rm backend npm ci
```

### テスト

```bash
cd backend  && npm test        # unit と integration。integration は MySQL が要る
cd frontend && npm test        # コンポーネント（@nuxt/test-utils）
cd e2e      && npm test        # Playwright。nginx 越しにスタック全体を叩く
```

`backend` の integration は、走るたびに `expense_claim_test` スキーマを冪等に作り直す。事前準備は要らないが、MySQL は起きている必要がある（`docker compose up -d mysql --wait`）。

Playwright のブラウザが無いと言われたら `cd e2e && npx playwright install chromium`。`sudo` は要らない。

### データベース

```bash
cd backend && npm run db:generate    # スキーマから SQL を生成する
cd backend && npm run db:migrate     # expense_claim へ適用する
```

生成された SQL は `backend/drizzle/` にコミットする（[`docs/design/03-database.md`](docs/design/03-database.md) 10.2）。**手で書き換えない。**

### 品質チェック

```bash
bash scripts/harness-check.sh
bash scripts/quality-check.sh
```

`quality-check.sh` は format → lint → typecheck → ユニット → API 統合 の順に走り、統合テストの前に MySQL を自分で起こす。

**PR を出す前に `RUN_E2E=1 bash scripts/quality-check.sh` も通す**（[`docs/design/07-development.md`](docs/design/07-development.md) 5.1）。

### 環境変数

`.env` は無くてよい。compose の既定値（データベース名 `expense_claim`、ユーザー / パスワード `expense`）で起動する。変えるときは [`.env.example`](.env.example) を `.env` にコピーして実値を入れる。本番の値は入れない。

アプリが読む変数は [`docs/design/05-integration.md`](docs/design/05-integration.md) 9章と `backend/src/config/env.ts`。開発では `compose.override.yaml` の既定値で動き、`GOOGLE_STUB=1` ならログインは Google へ行かずそのまま入れる。本番では `SESSION_SECRET` / `ALLOWED_EMAIL` / `TOKEN_ENCRYPTION_KEY` が必須。

`SPREADSHEET_ID` 以降が空でも起動し、その連携（取り込み・提出・領収書・アラート）だけが使えない。

開発の compose は `GOOGLE_STUB=1` で起動し、Google を叩かない開発用の実装（`backend/src/integrations/stub`）に
差し替わる。ログインは許可アドレスで通したことにしてホームへ戻る。対象月度は今月、提出は書いたことにして何も書かない。
E2E の提出導線はこれで通る。本番の `compose.yaml` はこの変数を渡さない。

### 実物の Google に繋いで確かめる

`.env` に OAuth クライアントとシート等の値を書き（[`.env.example`](.env.example)。クライアントの作り方は
[`docs/google-cloud-basics.md`](docs/google-cloud-basics.md) 13章 ⑦）、`GOOGLE_STUB` は **`.env` に書かずシェルから渡す**。

```bash
GOOGLE_STUB=0 docker compose up -d      # 実物に繋ぐ
docker compose up -d                    # 既定（スタブ）に戻す。E2E と品質チェックはこちら
```

`.env` に `GOOGLE_STUB=0` を書くと、Playwright が立てる compose も実物に繋がり、E2E が本物のシートへ書きに行く。

- **`SPREADSHEET_ID` にはサンドボックス（自分のドライブへの複製）を入れる。** 本番のシートを入れれば本番に書ける。
  提出の確認画面に出る「書き込み先」の名前で、実行前に確かめる
- スタブで発行したセッション Cookie は、同じ `SESSION_SECRET` なら実物に切り替えても有効のまま。ログインの入口を
  確かめるときは Cookie を消すか、設定の「すべての端末からログアウト」を押す
- 提出アラートは 1 日と 3 日の朝にしか送らないので、送る側を確かめるときは日付を与えて1回だけ走らせる。
  走ったあと `sync_state` の `last_alert_sent_on` と `last_cron_run_at` はその日付になるので、戻すか scheduler を再起動する

```bash
GOOGLE_STUB=0 docker compose run --rm scheduler npm run dev:scheduler -- --at=2026-10-01
```

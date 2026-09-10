# 開発環境・品質ゲート

## 1. この文書について

この文書は、交通費精算アプリを **どう起動し、どう品質を保つか** を決めたものである。
設計フェーズの7本目で、実装に入る前の **環境構築の結論** を置く。

- **扱うこと** — 開発サーバの起動、Lint / Format / 型チェック、テストの方針、CI の分担、ログの出し方
- **扱わないこと** — 画面の項目定義（[`02-screens.md`](02-screens.md)）、API の詳細（[`04-api.md`](04-api.md)）
- **前提** — [`01-architecture.md`](01-architecture.md) の技術選定

## 2. 開発環境の起動

### 2.1 日常の開発

```bash
docker compose up
```

`compose.override.yaml` が自動で読まれ、**開発モード** になる。

| サービス | 開発時の動き | 本番 compose |
| --- | --- | --- |
| nginx | `nginx/dev.conf` を bind mount。`/` は frontend:3000 へ proxy（HMR 対応）、`/api/` は backend:3000 へ | 載る |
| frontend | Nuxt dev サーバ。ソースを bind mount | **載らない。** 実行時はただのファイルで、nginx が配る |
| backend | `tsx watch` でホットリロード。ソースを bind mount | 載る |
| mysql | ホストから `127.0.0.1:3306` で接続可能（テスト用） | **載らない。** 本番は RDS |
| cloudbeaver | `http://127.0.0.1:8978/` から DB の中身を見る | **載らない。** ローカル専用 |

**URL は本番と同じ `http://localhost:8080`** である。パスで `/api/` と `/` を nginx が振り分ける。

**実行時に本番へ載らないものは `compose.override.yaml` に置く**（[`01-architecture.md`](01-architecture.md) 4.2）。
frontend / mysql / cloudbeaver の3つが該当する。

**`backend` の `depends_on: mysql` も override 側にある。** 本番のデータベースは RDS なので、
`compose.yaml` に書くと**使わない MySQL コンテナが healthy になるまで backend が起動しない。**
なお `depends_on` だけを override へ残して `mysql` を `compose.yaml` に置くことはできない。
`docker compose -f compose.yaml` が `depends on undefined service "mysql"` で落ちる。

**mysql のホスト側ポートは消せない。** API 統合テスト（`backend/test/database.ts`）と
マイグレーション（`backend/drizzle.config.ts`）は**コンテナの中ではなくホストの Node.js で走り**、
どちらも既定の接続先が `127.0.0.1:3306` だからである（3.2 でツールチェーンをホストに一本化した帰結）。
`0.0.0.0` ではなく **`127.0.0.1` バインド**なので LAN には出ない。ホストで別の MySQL が 3306 を
使っているときは `MYSQL_HOST_PORT` で逃がす。

### 2.2 本番相当の確認

```bash
docker compose -f compose.yaml up --build
```

`-f compose.yaml` を明示し、`compose.override.yaml` を読まない。
nginx イメージが frontend を `nuxt generate` して静的配信する。

**立つのは `nginx` と `backend` の2つだけである。** mysql も cloudbeaver も開発専用なので上がらない。
**これが EC2 で動くものと同じ構成である**（[`01-architecture.md`](01-architecture.md) 6.1 の縛り1）。

`DATABASE_URL` を渡さなければ backend は DB へ到達できない。**起動そのものは通る**
（`src/index.ts` は環境変数を読むだけで、接続は遅延する）ので、静的配信の確認はこのまま行える。
DB を触る API だけが接続失敗で落ちる。

### 2.3 依存を足したあと

frontend / backend は **名前付きボリューム** で `node_modules` をコンテナ内に閉じている。
ホストで `npm install` してもコンテナ側には反映されない。

```bash
docker compose run --rm frontend npm ci
docker compose run --rm backend npm ci
```

### 2.4 WSL2 でファイル監視が効かないとき

`compose.override.yaml` の frontend / backend に `CHOKIDAR_USEPOLLING=1` を足す。

### 2.5 コンテナはホストと同じ uid で動かす

**`frontend` / `backend` の Dockerfile は `USER node` で動かす。**
`node:24-alpine` の `node` は **uid 1000 / gid 1000** で、WSL2 のログインユーザーと一致する。

**root のままだと、バインドマウント越しにホストへ root 所有のファイルが残る。**
Nuxt は起動のたびに `.nuxt/` を書き直すので、次にホストで `npm run typecheck` を走らせると
`EACCES` で落ちる。**`quality-check.sh` が止まり、フックがコミットを弾く。**

`node_modules` の名前付きボリュームは、**最初に作られた時点の所有者のまま固定される。**
`USER` を変えたときは作り直す。

```bash
docker compose down
docker volume rm expense-claim_frontend_node_modules expense-claim_backend_node_modules
docker compose up -d --build
```

## 3. ツールチェーン

### 3.1 採用

| 用途 | 選定 |
| --- | --- |
| Lint | **ESLint 10** — frontend は `@nuxt/eslint`、backend / e2e は `typescript-eslint` |
| Format | **Prettier 3** — タブ・シングルクォート・セミコロンあり |
| 型チェック | frontend: `nuxt typecheck`（vue-tsc）、backend / e2e: `tsc --noEmit` |
| テスト | **Vitest 5** — backend / frontend。frontend は `@nuxt/test-utils` ＋ `@vue/test-utils` ＋ happy-dom |
| E2E | **Playwright 1.63** — `e2e/`。ブラウザは chromium 1本、既定の端末は Pixel 7（`NF-01`） |
| DB アクセス | **Drizzle ORM 0.45** ＋ `mysql2`。マイグレーションは `drizzle-kit` |
| 入力検証 | **Zod 4** — いまは環境変数の検証だけ |
| Node.js | **24**（`.nvmrc`） |

**npm workspaces にはしない。** ルートに lockfile が移ると Docker の「パッケージ単位で `npm ci`」が壊れる。
設定の重複より、ビルドがパッケージ完結であることを取る。

**backend は tsconfig を2枚持つ。** `tsconfig.json` は型チェック用で `src` / `test` / `*.config.ts` を見る。
`tsconfig.build.json` はビルド用で `src` だけを見て `*.test.ts` を外す。
**1枚にすると、テストファイルが `dist/` へ入って本番イメージに載る。**

### 3.2 採らなかった案

| 案 | 却下理由 |
| --- | --- |
| **Biome** | `.vue` の `<template>` を解析できず、Vue 固有ルールを掛けられない |
| **npm workspaces** | 上記。Docker ビルドが repo 全体に依存する |
| **ホスト実行** | Node のバージョン差が出うる |
| **compose とホストの二重構成** | 設定が二重になる |

## 4. テストの方針

**ユニット＋ API 統合＋ E2E 主要導線** を採る。11画面すべての E2E は維持コストが高いので対象外。

| 種別 | 実行場所 | DB |
| --- | --- | --- |
| ユニット | backend の services / domain / config | 使わない |
| API 統合 | backend の routes / repositories | compose の MySQL **`expense_claim_test`** スキーマ |
| コンポーネント | frontend（`@nuxt/test-utils`） | — |
| E2E | リポジトリ直下の `e2e/`（Playwright） | compose 全体を nginx 越しに叩く |

**DB テストは compose の MySQL に test スキーマを使う。** Testcontainers は起動が遅い。
SQLite は `utf8mb4_ja_0900_as_cs` を検証できない。モックは SQL の誤りを捕まえられない。

**E2E の「帰り道の2手」「提出」導線は、画面が出来てから足す**（[`02-screens.md`](02-screens.md) 2.2 / 3.9）。
いま `e2e/` にあるのは**スモーク1本だけ**である（トップが開く／`GET /api/health` が 200）。

### 4.1 テスト用スキーマの用意

**`docker-entrypoint-initdb.d` は使わない。** あれは **データディレクトリが空のときにしか走らない**ので、
既に `mysql_data` ボリュームが育っている環境では黙って何も起きない。
「初期化 SQL を置いたのに何も起きない」という読み違いを生む。

代わりに **Vitest の `globalSetup`**（`backend/test/global-setup.ts`）が、走るたびに冪等に用意する。

1. root で接続し `CREATE DATABASE IF NOT EXISTS expense_claim_test`（照合順序は本番と同じ）
2. `GRANT ALL` をアプリのユーザーへ与える
3. `drizzle-orm/mysql2/migrator` で `backend/drizzle/` を適用
4. 各テストの前に対象テーブルを `TRUNCATE`（マイグレーション台帳は残す）

**MySQL へ繋がらないときは、起こし方を言って落ちる。** 黙ってスキップしない。

### 4.2 backend は unit と integration の2プロジェクト

`backend/vitest.config.ts` が分ける。**`integration` だけが実 MySQL を要る。**

| プロジェクト | 対象 | `npm run` |
| --- | --- | --- |
| `unit` | `src/**/*.test.ts` | `test:unit` |
| `integration` | `src/**/*.integration.test.ts` | `test:integration` |

`integration` は同じテスト用スキーマを共有するので `fileParallelism: false` にしている。

### 4.3 採らなかった案

| 案 | 却下理由 |
| --- | --- |
| ユニットのみ | 「2手で終わる」を機械で守れない |
| 11画面 E2E | 維持コストが高い |
| Testcontainers | 起動が遅い |
| SQLite（テスト DB） | 照合順序を検証できない |

## 5. 品質ゲートの分担

| 層 | 担当 | いつ走るか |
| --- | --- | --- |
| 共通 | `scripts/harness-check.sh` | commit / push 前（フック） |
| プロジェクト | `scripts/quality-check.sh` | commit / push 前（フック） |
| CI | `.github/workflows/build.yml` | PR と main への push |

### 5.1 quality-check.sh の内容

ホストの Node.js で、上から順に fail fast する。

1. `format:check`（Prettier）
2. `lint`（ESLint）
3. `typecheck`
4. ユニットテスト（backend の `test:unit` / frontend の `test`）
5. API 統合テスト（backend の `test:integration`）

**5 の前に `docker compose up -d mysql --wait` を自分で行う。**
MySQL が落ちていても走るようにするためで、**「繋がらないので飛ばす」はしない。**
Docker が居ない・起こせないときは `3`（環境問題）で抜ける。

**E2E は既定では走らせない。** `RUN_E2E=1 bash scripts/quality-check.sh` のときだけ。
フックは `git push` に掛かるので、E2E を既定にすると送信のたびにブラウザ起動を待つ。

**PR を出す前に一度 `RUN_E2E=1` で通す** こと（Issue B 以降）。

### 5.2 CI

**`docker compose -f compose.yaml build` だけを見る。** Lint / テストはローカルフックが担保する。
`-f compose.yaml` を省くと `compose.override.yaml` が読まれ、CI が開発構成をビルドしてしまう。

### 5.3 採らなかった案

| 案 | 却下理由 |
| --- | --- |
| CI で Lint / テストも全部 | ローカルフックと二重になる |

## 6. ログの出し方

**Hono の `logger()` ミドルウェア＋`console` で標準出力へ1行テキスト。** Docker が拾う。

**`pino` は採らない。** Node.js 依存が重く、目的②（Cloudflare Workers）で外すことになる。

**要確認事項の正本は `attentions` テーブルであってログではない**（[`06-error-handling.md`](06-error-handling.md) 2章）。

## 7. UI 基盤

**選定と採らなかった案は [`01-architecture.md`](01-architecture.md) 3.4.1 が正本。**
ここには開発で引っかかる点だけ書く。

| どこに | 何を |
| --- | --- |
| `frontend/app/assets/css/main.css` | `@import 'tailwindcss';` と `@import '@nuxt/ui';` の2行だけ |
| `frontend/app/app.config.ts` | 色だけ（`primary: teal` / `neutral: slate`）。それ以上は作り込まない |
| `frontend/app/app.vue` | 最上位に `<UApp>`。トースト・モーダル・ツールチップの土台になる |

**アイコンは `@iconify-json/lucide` をローカルに入れる。**
入れないと `@nuxt/icon` が実行時に API を叩きに行く。
**ビルドとテストをネットワークに依存させない**ため、コレクションごと持つ。

**Tailwind は個別に入れない。** `@nuxt/ui` が依存として持ち込む。

## 8. 未確定事項

| 何が | どこで決めるか |
| --- | --- |
| テストのカバレッジ閾値 | 実装が積まれてから |
| Pinia（状態管理） | 画面をまたぐ状態が出てから |
| OpenAPI 等の機械可読定義 | 必要になってから（[`04-api.md`](04-api.md) 10章） |

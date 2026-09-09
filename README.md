# expense-claim

交通費申請を行うアプリです。

- **要求分析**（なぜ作るのか・何が欲しいのか）: [`docs/requirements-analysis.md`](docs/requirements-analysis.md)
- **要件定義**（いま守る約束）: [`docs/requirements.md`](docs/requirements.md)
- **決定ログ**（なぜ決めたか・なぜ覆したか）: [`docs/decisions.md`](docs/decisions.md)
- **設計**（どう作るか）: [`docs/design/`](docs/design/) — 技術選定・画面・データベース・API・
  外部連携・異常系。**[`01-architecture.md`](docs/design/01-architecture.md) から読んでください。**
- **Google Cloud 入門**: [`docs/google-cloud-basics.md`](docs/google-cloud-basics.md) —
  このアプリで使う範囲の Google Cloud を、**提案の是非を判断できるようになること**を目的に
  まとめています。セットアップ手順もここにあります。
- **提出シート検証ツール**: [`tools/sheet-probe/`](tools/sheet-probe/) — 提出先スプレッドシートへ
  API から読み書きできるかを実機で確かめます。様式が変わったときに再実行してください。
- **依頼メール検証ツール**: [`tools/gmail-probe/`](tools/gmail-probe/) — 依頼メールを Gmail API から
  読み、案件として取り込めるかを実機で確かめます。メールの書式が変わったときに再実行してください。

## 開発環境

Nuxt 4 の SPA と Hono 4 の API を、nginx が同一オリジンで振り分ける。ローカルだけ MySQL 8.4 と CloudBeaver も立つ。

```bash
docker compose up --build
```

- アプリ: http://localhost:8080/
- CloudBeaver: http://127.0.0.1:8978/ （初回は管理者と MySQL 接続を画面で作る。ホストは `mysql`、ポート `3306`）

`.env` は無くてよい。compose の既定値（データベース名 `expense_claim`、ユーザー / パスワード `expense`）で起動する。変えるときはリポジトリ直下に `.env` を置き、次を書く。

```
MYSQL_DATABASE=expense_claim
MYSQL_USER=expense
MYSQL_PASSWORD=expense
MYSQL_ROOT_PASSWORD=expense
```

`.env.example` はフックで触れなかったので、雛形はここにある。本番の値は入れない。

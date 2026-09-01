# expense-claim

交通費申請を行うアプリです。

- **要求分析**（なぜ作るのか・何が欲しいのか）: [`docs/requirements-analysis.md`](docs/requirements-analysis.md)
- **要件定義**（何を満たすか）: [`docs/requirements.md`](docs/requirements.md)
- **設計**（どう作るか）: [`docs/design/`](docs/design/) — 技術選定・画面・データベース・API・
  外部連携・異常系。**[`architecture.md`](docs/design/architecture.md) から読んでください。**
- **Google Cloud 入門**: [`docs/google-cloud-basics.md`](docs/google-cloud-basics.md) —
  このアプリで使う範囲の Google Cloud を、**提案の是非を判断できるようになること**を目的に
  まとめています。セットアップ手順もここにあります。
- **提出シート検証ツール**: [`tools/sheet-probe/`](tools/sheet-probe/) — 提出先スプレッドシートへ
  API から読み書きできるかを実機で確かめます。様式が変わったときに再実行してください。
- **依頼メール検証ツール**: [`tools/gmail-probe/`](tools/gmail-probe/) — 依頼メールを Gmail API から
  読み、案件として取り込めるかを実機で確かめます。メールの書式が変わったときに再実行してください。

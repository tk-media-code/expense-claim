# sheet-probe

提出シートへ API から読み書きできるかを実機で確かめる検証スクリプト（Issue #13）。
**アプリ本体とは切り離した使い捨て**で、ここでの技術選定はアプリの技術選定ではない。

提出シートは委託元の所有物であり、実データが入っている（要求分析 N-04）。
いきなり書き込まず、**読み取り → 自分のドライブへ複製して書き込み → 実シートは最小限**の
3段階に分けてある。

## 準備

### 1. Google Cloud

**手順と、その理由は [`docs/google-cloud-basics.md`](../../docs/google-cloud-basics.md) にまとめてある。**
プロジェクトの作成・API の有効化・同意画面・スコープ・OAuth クライアントまで、
そちらの「第2部 セットアップ手順」を見ること。

Google Cloud を触ったことがなければ、第1部から読むと**なぜそう設定するのか**が分かる。

### 2. このリポジトリ側

```bash
cp .env.example .env      # 実値を入れる。コミットしない
mkdir -p credentials
# 落とした OAuth クライアント JSON を credentials/oauth-client.json へ置く
npm --prefix tools/sheet-probe install
```

`.env` `credentials/` `token*.json` `tools/**/out/` は `.gitignore` 済み。
**このリポジトリは public なので、実値を一切コミットしない（N-08）。**

## 使い方

```bash
node tools/sheet-probe/probe.cjs read           # 段階A 読み取りのみ。無害
node tools/sheet-probe/probe.cjs sandbox        # 段階B 複製を作る
node tools/sheet-probe/probe.cjs write-sandbox  # 段階B 複製へ書き込む
node tools/sheet-probe/probe.cjs verify-live    # 段階C 実シート。1セルのみ。都度承認
```

初回は認可 URL が端末に出るので、ブラウザで開いて許可する。
トークンは `credentials/token.json` に保存され、2回目以降は再利用される。

出力の全文は `tools/sheet-probe/out/` に残る。**他スタッフの氏名と実績データを含むため、
決してコミットしない。** 端末に出る要約では氏名を伏せてある。

## 何を確かめているか

| 段階 | 確かめること |
| --- | --- |
| A | 保護範囲（`protectedRanges` の `requestingUserCanEdit`）、合計式の集計範囲、入力規則の届く範囲、結合セル、ロケールとタイムゾーン |
| B | 日付が日付として入るか、合計式の範囲外に書くと静かに漏れるか（N-07）、行挿入で集計範囲が伸びるか、入力規則が API 経由で効くか、結合セルへ書けるか、乗り換えを複数行へ展開できるか（R-08） |
| C | 本文行へ書けて消せるか、保護範囲への書き込みが拒否されるか |

**他人のシートへは書き込まない。** `requestingUserCanEdit` が API 自身の答えとして
編集可否を返すため、試す必要がない。

## 認可について

**OAuth そのものの仕組みは [`docs/google-cloud-basics.md`](../../docs/google-cloud-basics.md) の
「6. 認証と認可」にある。** ここに書くのは、このスクリプト固有の実装上の判断だけ。

`@google-cloud/local-auth` は使っていない。ブラウザを自動起動する実装で、WSL2 では
Windows 側のブラウザを開けずに詰まるため。代わりに認可 URL を端末へ出力し、
リダイレクトを2経路で受ける。

1. `127.0.0.1` に立てたサーバーで受け取る（WSL2 の localhost 転送が効く場合）
2. 効かない場合は、ブラウザのアドレスバーの URL を丸ごと端末へ貼り付ける

かつての手動コピー用フロー（`urn:ietf:wg:oauth:2.0:oob`）は廃止済みで使えない。

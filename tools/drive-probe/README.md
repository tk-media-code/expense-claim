# drive-probe

`drive.file` で、アプリが作っていない既存フォルダの下にファイルを作れるかを
実機で確かめる検証スクリプト（Issue #61）。
**アプリ本体とは切り離した使い捨て**で、ここでの技術選定はアプリの技術選定ではない。

`drive.file` は**アプリが作った／開いたファイルしか触れない。**
アプリが作っていない親フォルダを指定して `files.create` できるかが争点だった
（`docs/design/integration.md` 3.3）。文献上は「できない」側の材料が出ていた。

**2026-09-09 に実測して閉じた。** `drive.file` だけで既存フォルダの下に作れ、
共有と `webViewLink` も取れた。親フォルダのメタデータは 404 で読めない。
結果は `integration.md` 3.3・`google-cloud-basics.md` 8章 / 15章・要件定義 13章に書いてある。

## 何を確かめるか

**狭いトークンだけで失敗しても、それだけではスコープのせいと言い切れない。**
フォルダIDの打ち間違い・フォルダの消滅でも同じ失敗になる。
同じフォルダ・同じ操作を2つのトークンで走らせ、
**広いほうが通って狭いほうが落ちる**ことを見て初めて原因をスコープに帰せる。

| コマンド | トークン | スコープ | 期待 |
| --- | --- | --- | --- |
| `narrow` | `credentials/token-drive-file.json`（新規） | `drive.file` だけ | 文献上は失敗 |
| `broad` | `credentials/token.json`（既存） | `drive`（広い） | 成功 |
| `compare` | — | — | 2つを並べて結論を出す |

**取り違えはコード自身が止める。** 認可後に `getTokenInfo()` で実際の付与スコープを読み、
`narrow` に広い `drive` が混ざっていたら即座に中止する。
ファイル名を間違えて広いトークンを使うと「`drive.file` でできた」と誤報告するため。

## 検証先

**Drive 上に検証用フォルダを1つ手で作り、その ID を `.env` の `DRIVE_PROBE_FOLDER_ID` へ入れる。**

手で作れば「アプリが作っていない既存フォルダ」という条件を満たす。
プローブ自身にフォルダを作らせると、それはアプリが作ったフォルダになり、
確かめたい条件から外れる。**実の領収書フォルダは使わない。**

フォルダIDの実値はコミットしない（要求分析 N-08）。

## 準備

```bash
# .env に DRIVE_PROBE_FOLDER_ID を足す（手で作った検証用フォルダのID）
npm --prefix tools/drive-probe install
```

OAuth クライアントは `sheet-probe` と同じものを使う。
`narrow` の初回だけ、`drive.file` の認可 URL が端末に出るのでブラウザで開く。

## 使い方

```bash
node tools/drive-probe/probe.cjs narrow   # 段階A drive.file で試す（本題）
node tools/drive-probe/probe.cjs broad    # 段階B drive で同じことを試す（対照）
node tools/drive-probe/probe.cjs compare  # 段階C 2つの結果を並べて結論を出す
```

各段階が見るもの。

| # | すること | 何が分かるか |
| --- | --- | --- |
| 1 | 付与スコープを `getTokenInfo()` で確認 | 取り違えの検出。想定と違えば中止 |
| 2 | `files.get(DRIVE_PROBE_FOLDER_ID)` | 既存フォルダのメタデータを読めるか |
| 3 | `files.create`（`parents` に検証用フォルダ） | **本題。** 小さなテキストファイルを作る |
| 4 | `permissions.create`（`anyone` / `reader`） | 3 が通ったときだけ。F-25 が成立するか |
| 5 | `files.get(webViewLink)` | 3 が通ったときだけ。提出シートに書く URL を取れるか（R-15） |
| 6 | `files.delete` | 後片付け。作ったものを消す |

失敗はエラーコードごと記録する。404 と 403 では意味が違う。

出力の全文は `tools/drive-probe/out/` に残る。**コミットしない**
（`.gitignore` の `tools/**/out/` で除外済み）。文書にフォルダIDを書かない。

## 実装上の判断

**認可は `sheet-probe/auth.cjs` を require して使い回す。複製しない。**
`gmail-probe` と同じ原則である。スコープは狭く保つのが原則で、
その原則は定義が1箇所にないと守れない。
`auth.cjs` の既定スコープは変えない。呼び出し側が渡したときだけ差し替える。

**検証用フォルダは人が手で作る。**
プローブがフォルダを作ると、それはアプリが作ったフォルダになり、争点から外れる。

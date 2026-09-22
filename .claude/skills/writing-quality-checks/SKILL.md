---
name: writing-quality-checks
description: このプロジェクト固有の品質チェック（scripts/quality-check.sh）を作る・直す。「Lint を push 前に回したい」「テストを自動で走らせたい」「品質チェックを追加して」「型チェックを入れて」と言われたときに使う。ハーネス共通のチェックとは所有権が分かれているので、共通側を直しにいかないこと。
---

# プロジェクト固有の品質チェックを書く

品質チェックは2段構えで、**ファイル名で所有権が分かれている。**

| | 中身 | 所有 | 直す場所 |
| --- | --- | --- | --- |
| `scripts/harness-check.sh` | コンフリクトマーカー・秘匿情報・ブランチ名・Issue の実在 | ハーネス | ハーネスの `share/templates/` |
| `scripts/quality-check.sh` | Lint・型・テストなど、このプロジェクト固有のもの | プロジェクト | **ここ。このリポジトリで自由に書く** |

**`scripts/harness-check.sh` を直さない。** 全プロジェクトへ配られている共有物なので、
書き換えるとこのリポジトリだけ更新が届かなくなる。**言語・スタックに依存するものは
すべて `scripts/quality-check.sh` に置く。**

## いつ走るか

**`git push` を hook が検知したときに、共通チェックの次に自動で走る。**
落ちると送信そのものがブロックされる。手で叩く運用ではない。

```
push を検知 → harness-check.sh → quality-check.sh → 送信
                     ↓ 落ちた          ↓ 落ちた
                  ブロック          ブロック
```

共通チェックが落ちた時点でここは走らない（安いほうを先に置いている）。

## 終了コードの規約

| コード | 意味 | AI がどう動くか |
| --- | --- | --- |
| `0` | 合格 | 送信される |
| `1` | 品質上の指摘あり | 指摘を直してコミットし直す |
| `3` | 環境の問題で実行できない | **コードを直しても解決しない。**環境を整えるか人に聞く |

**`3` を正しく返すことが効く。** コンテナが起動していない・依存が入っていないだけのときに
`1` を返すと、AI が存在しない指摘を直そうとしてコードをいじり始める。

```bash
if ! command -v npm >/dev/null 2>&1; then
	echo "npm が見つかりません。Node.js を入れてから実行してください。" >&2
	exit 3
fi
```

## 検査対象は「これから出ていくもの」に絞る

**既存のコードベース全体を検査しない。** 過去から残っている指摘で新しい作業が止まる。

```bash
# 既定ブランチからの分岐点〜HEAD ＋ 未コミットの変更
base="$(git merge-base origin/main HEAD 2>/dev/null || echo '')"
if [ -n "$base" ]; then
	mapfile -t changed < <(git diff --name-only --diff-filter=d "$base" HEAD)
fi
mapfile -t dirty < <(git diff --name-only --diff-filter=d HEAD)
mapfile -t untracked < <(git ls-files --others --exclude-standard)
```

テストのように「全体を走らせないと意味がないもの」は例外。**その場合は速さを気にする。**
push のたびに走るので、数分かかるものは運用が破綻する。

## 骨組み

```bash
#!/bin/bash
# このプロジェクト固有の品質チェック。
# 共通チェック（scripts/harness-check.sh）はハーネスが持っている。ここには
# 言語・スタックに依存するものだけを置く。
#
# 終了コード: 0 合格 / 1 指摘あり / 3 環境の問題で実行できない

set -uo pipefail

findings=0
fail() {
	findings=$((findings + 1))
	printf '\n[NG] %s\n' "$1"
	shift
	[ $# -gt 0 ] && printf '%s\n' "$@"
	return 0
}

cd "$(git rev-parse --show-toplevel)" || exit 3

# --- 環境の確認 ---
command -v npm >/dev/null 2>&1 || {
	echo "npm が見つかりません。" >&2
	exit 3
}

# --- ① Lint ---
if ! out="$(npm run lint 2>&1)"; then
	fail "Lint に指摘があります" "$out"
fi

# --- ② 型チェック ---
if ! out="$(npm run typecheck 2>&1)"; then
	fail "型エラーがあります" "$out"
fi

# --- ③ テスト ---
if ! out="$(npm test 2>&1)"; then
	fail "テストが失敗しています" "$out"
fi

if [ "$findings" -gt 0 ]; then
	printf '\nプロジェクト品質チェック: %d 件の指摘があります。\n' "$findings"
	exit 1
fi

echo "プロジェクト品質チェック: 指摘はありません。"
exit 0
```

**指摘の本文をそのまま出す。** この出力がそのまま AI に渡って修正の材料になる。
「Lint に失敗しました」だけでは何も直せない。

## 作ったら確かめる

```bash
chmod +x scripts/quality-check.sh
bash -n scripts/quality-check.sh     # 構文
bash scripts/quality-check.sh        # 実際に走らせる
echo "exit=$?"
```

**わざと落としてみる。** 指摘が出る状態を作って `1` が返るか、依存を外して `3` が返るか。
通る場合しか試していないチェックは、落ちるべきときに落ちない。

## 一部を外したいとき

共通チェックの個別項目はリポジトリ直下の `.harness.json` で外せる。

```json
{ "checks": { "branch-name": false } }
```

外せるのは `conflict-markers` / `secrets` / `branch-name` / `issue-exists`。
**プロジェクト側のチェックは自分で書いたものなので、要らなければ消せばよい。**

## よくある言い訳

| 考え | 現実 |
| --- | --- |
| 「共通チェックに足すほうが早い」 | 共有物。書き換えるとこのリポジトリだけ更新が届かなくなる |
| 「テストは CI で走るからここでは要らない」 | CI は push のあと。ここは push の前。壊れたものが出ていかない担保になる |
| 「全ファイルを検査したほうが確実」 | 過去の指摘で新しい作業が止まる。これから出ていくものだけを見る |
| 「環境が無いときも 1 を返せばいい」 | AI が存在しない指摘を直そうとする。環境の問題は `3` |
| 「落ちる場合は試さなくても分かる」 | 落ちるべきときに落ちないチェックは、無いのと同じ |

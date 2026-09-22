---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work. 実装が終わって統合の段になったら使う。このリポジトリ版は Superpowers の同名スキルを差し替えたもので、選択肢が「push して PR」の1本に絞ってある。
---

# 開発ブランチを終える

**このスキルは Superpowers の `finishing-a-development-branch` を、このリポジトリの
運用に合わせて差し替えたものです。** 上流版は「ローカルで main にマージする」を
選択肢に出しますが、**このリポジトリでは採れません**（GitHub 側と hook の両方が拒否します）。
統合の経路は Pull Request の1本だけです。

**開始時に宣言する:** 「finishing-a-development-branch スキルで作業を仕上げます。」

## 1. テストを確認する

プロジェクトのテストを全部走らせる（`npm test` / `cargo test` / `pytest` / `go test ./...`）。

**落ちているなら、そこで止めて報告する。** 統合の話はテストが緑になってから。

```
テストが失敗しています（<N> 件）。統合の前に直す必要があります:

[失敗の内容]
```

**「さっき通った」は根拠にならない。** これから統合する木の上で走らせた結果だけが証拠になる。

## 2. どこで作業しているかを判定する

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
WORKTREE_PATH=$(git rev-parse --show-toplevel)
BRANCH=$(git branch --show-current)
```

| 状態 | 意味 |
| --- | --- |
| `GIT_DIR == GIT_COMMON` | 通常のチェックアウト。worktree の後片付けは要らない |
| `GIT_DIR != GIT_COMMON`、ブランチ上 | linked worktree。後片付けは 5 を見る |
| `GIT_DIR != GIT_COMMON`、detached HEAD | 外部管理の作業場。ブランチを作ってから送る |

detached HEAD の場合は、送信の前にブランチを作る。名前は Issue 番号を含む規約に従う。

```bash
git switch -c feature/<issue番号>-<内容>
```

## 3. 統合の方法はひとつ

```
実装が完了しました。

  push して Pull Request を作ります。マージはユーザーが内容を確認した上で行います。

このまま進めてよいですか？
```

**選択肢を並べない。** このリポジトリで採れる統合は PR だけなので、
「ローカルにマージしますか」と聞くのは、拒否される操作を提案していることになる。

**破棄はユーザーが明示的に求めたときだけ。** 「もういい」「消していい」では足りない。
上流版と同じく、消す対象（ブランチ・コミット・worktree）を並べて見せ、
`discard` と打ってもらってから消す。

## 4. `submit-pull-request` へ渡す

送信と PR の作成は `submit-pull-request` スキルが持っている。

- 品質チェックは push 時に hook が自動で回す。**手で叩かない**
- PR 本文に `Closes #<issue番号>` を必ず入れる
- **`gh pr merge` は実行しない。** PR の URL を渡して止まる

## 5. worktree は PR が終わるまで残す

**PR を出した時点では worktree を消さない。** レビューの指摘はその worktree で直す。

片付けるのは、マージが済んで `sync-after-merge` を通すとき。そのとき消すのは
**`.worktrees/` または `worktrees/` の下にあるものだけ。** それ以外はホスト環境の持ち物。

```bash
git worktree remove "$WORKTREE_PATH"
git worktree prune
```

**`contains modified or untracked files` で拒否されたら `--force` を付けない。**
そこにしか無いファイルがあるということなので、中身を見せて人に判断を仰ぐ。

```bash
git -C "$WORKTREE_PATH" status --porcelain -uall
```

## よくある言い訳

| 考え | 現実 |
| --- | --- |
| 「テストはさっき通った」 | これから統合する木の上で走らせる。緑だったのは走らせた木の話 |
| 「上流のスキルには3択と書いてある」 | このリポジトリでは2つが拒否される。拒否される操作を選択肢に出さない |
| 「ローカルでマージすれば早い」 | `main` への直接の変更は GitHub 側と hook の両方が拒否する |
| 「PR を出したから worktree はもう要らない」 | レビューの指摘はそこで直す。マージまで残す |
| 「『もういい』と言われたから破棄する」 | 破棄は `discard` と打ってもらってから |
| 「push が拒否された。force push で通す」 | リモートが進んでいる。調べる。force push は人が明示的に求めたときだけ |

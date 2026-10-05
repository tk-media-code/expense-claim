---
name: writing-quality-checks
description: このプロジェクト固有の品質チェック（scripts/quality-check.cjs または scripts/quality-check.sh）を作る・直す。「Lint を push 前に回したい」「テストを自動で走らせたい」「品質チェックを追加して」「型チェックを入れて」と言われたときに使う。ハーネス共通のチェックとは所有権が分かれているので、共通側を直しにいかないこと。
---

# プロジェクト固有の品質チェックを書く

品質チェックは2段構えで、**ファイル名で所有権が分かれている。**

| | 中身 | 所有 | 直す場所 |
| --- | --- | --- | --- |
| `scripts/harness-check.cjs` | コンフリクトマーカー・秘匿情報・ブランチ名・Issue の実在・プロジェクトの品質チェックが置いてあるか | ハーネス | ハーネスの `share/templates/` |
| `scripts/quality-check.cjs` または `scripts/quality-check.sh` | Lint・型・テストなど、このプロジェクト固有のもの | プロジェクト | **ここ。このリポジトリで自由に書く** |

**`scripts/harness-check.cjs` を直さない。** 全プロジェクトへ配られている共有物なので、
書き換えるとこのリポジトリだけ更新が届かなくなる。**言語・スタックに依存するものは
すべて `scripts/quality-check.*` に置く。**

## Node か bash か

どちらで書いてもよい。hook は拡張子で起動方法を選ぶ（`.cjs` / `.mjs` / `.js` は Node、`.sh` は bash）。
両方あれば `.cjs` が優先される。

| | 選ぶとき | 注意 |
| --- | --- | --- |
| **Node（`quality-check.cjs`）** | Windows でも動かすプロジェクト。**迷ったらこちら** | `npm` `npx` は Windows では `.cmd` のシムなので、`shell: true` で起動する（下のひな型がそうなっている） |
| **bash（`quality-check.sh`）** | Linux / macOS だけで動かすプロジェクト。既に bash で書いてあるもの | Windows では Git Bash で走る。**改行は LF。** `scripts/.gitattributes` が強制している。CRLF だと `\r` で落ちる |

## いつ走るか

**`git push` を hook が検知したときに、共通チェックの次に自動で走る。**
落ちると送信そのものがブロックされる。手で叩く運用ではない。

```
push を検知 → harness-check.cjs → quality-check.cjs（または .sh） → 送信
                     ↓ 落ちた                ↓ 落ちた
                  ブロック                ブロック
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

```js
if (!run('npm', ['--version']).ok) {
	process.stderr.write('npm が見つかりません。Node.js を入れてから実行してください。\n');
	process.exit(3);
}
```

## 検査対象は「これから出ていくもの」に絞る

**既存のコードベース全体を検査しない。** 過去から残っている指摘で新しい作業が止まる。

この例は既定ブランチが見つからないときだけ、出ていくものを取りこぼさないよう追跡ファイル全体に倒す。実際の既定ブランチは配列の先頭に足す（`mergeBase()` は最初に解決した ref を使うので、末尾に足しても main があるとそちらが勝つ）。

```js
// 既定ブランチからの分岐点〜HEAD（取れなければ追跡ファイル全体）＋ 未コミットの変更。git の出力は -z で受ける
// （空白や日本語を含むファイル名を行で切らない）。
function gitList(args) {
	try {
		// 出力の上限で黙って切り捨てない（超えると検査対象が空になる。共通チェックと同じ）。
		return execFileSync('git', [...args, '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: Infinity }).split('\0').filter(Boolean);
	} catch {
		return [];
	}
}
// 既定ブランチとの分岐点。候補は共通チェック（harness-check.cjs）と同じ順に探す。
// どれも取れなければ追跡ファイル全体に倒す。取りこぼすより過剰に見るほうが安全。
function mergeBase() {
	// 既定ブランチが main / master でないリポジトリは、この配列の先頭に足す（例: 'origin/develop'）。
	// 末尾に足すと、main が実在する限りそちらが先に見つかって勝つ。
	for (const ref of ['origin/main', 'main', 'origin/master', 'master']) {
		try {
			return git(['merge-base', ref, 'HEAD']);
		} catch {
			// その候補が無い（または履歴がつながっていない）。次を試す。
		}
	}
	return '';
}
const base = mergeBase();
if (!base) process.stdout.write('既定ブランチが見つかりません。追跡ファイル全体を検査します。\n');
const changed = new Set([
	...(base ? gitList(['diff', '--name-only', '--diff-filter=d', base, 'HEAD']) : gitList(['ls-files'])),
	...gitList(['diff', '--name-only', '--diff-filter=d', 'HEAD']),
	...gitList(['ls-files', '--others', '--exclude-standard']),
]);
```

テストのように「全体を走らせないと意味がないもの」は例外。**その場合は速さを気にする。**
push のたびに走るので、数分かかるものは運用が破綻する。

## 骨組み（Node）

```js
#!/usr/bin/env node
// このプロジェクト固有の品質チェック。
// 共通チェック（scripts/harness-check.cjs）はハーネスが持っている。ここには
// 言語・スタックに依存するものだけを置く。
//
// 終了コード: 0 合格 / 1 指摘あり / 3 環境の問題で実行できない
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');

let findings = 0;
function fail(title, ...lines) {
	findings += 1;
	process.stdout.write(`\n[NG] ${title}\n`);
	for (const line of lines) process.stdout.write(`${line}\n`);
}

// 引数を 1 つずつシェル向けに囲んでから 1 本のコマンド文字列にする。
// shell: true は Windows のため（npm / npx は .cmd のシムで、シェル無しでは起動できない）。
// 囲まずに渡すと、( や空白を含むファイル名が壊れ、ファイル名がシェルに解釈される。
function quote(arg) {
	const s = String(arg);
	if (process.platform === 'win32') return `"${s.replace(/"/g, '\\"')}"`;
	return `'${s.replace(/'/g, `'\\''`)}'`;
}
// 出力の上限で子プロセスを止めない（大量の本物の指摘を「起動できない」にしないため。共通チェックと同じ）。
function run(cmd, args = []) {
	const line = [cmd, ...args.map(quote)].join(' ');
	const r = spawnSync(line, { encoding: 'utf8', shell: true, maxBuffer: Infinity });
	if (r.error) {
		process.stderr.write(`${cmd} を起動できません: ${r.error.message}\n`);
		process.exit(3);
	}
	return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

let root;
try {
	root = git(['rev-parse', '--show-toplevel']);
} catch {
	process.stderr.write('git リポジトリの中で実行してください。\n');
	process.exit(3);
}
process.chdir(root);

// --- 環境の確認 ---
if (!run('npm', ['--version']).ok) {
	process.stderr.write('npm が見つかりません。Node.js を入れてから実行してください。\n');
	process.exit(3);
}

// --- ① Lint ---
{
	const r = run('npm', ['run', 'lint']);
	if (!r.ok) fail('Lint に指摘があります', r.out);
}

// --- ② 型チェック ---
{
	const r = run('npm', ['run', 'typecheck']);
	if (!r.ok) fail('型エラーがあります', r.out);
}

// --- ③ テスト ---
{
	const r = run('npm', ['test']);
	if (!r.ok) fail('テストが失敗しています', r.out);
}

// process.exit は書き残しを捨てる（Linux のパイプは非同期なので、長い出力の末尾が消える）。終了コードだけ決めて自然に終える。
if (findings > 0) {
	process.stdout.write(`\nプロジェクト品質チェック: ${findings} 件の指摘があります。\n`);
	process.exitCode = 1;
} else {
	process.stdout.write('プロジェクト品質チェック: 指摘はありません。\n');
}
```

## 骨組み（bash）

```bash
#!/bin/bash
# このプロジェクト固有の品質チェック。
# 共通チェック（scripts/harness-check.cjs）はハーネスが持っている。ここには
# 言語・スタックに依存するものだけを置く。
#
# 終了コード: 0 合格 / 1 指摘あり / 3 環境の問題で実行できない
# 改行は LF（Windows の Git Bash でも動かすため。scripts/.gitattributes が強制する）

set -uo pipefail

findings=0
fail() {
	findings=$((findings + 1))
	printf '\n[NG] %s\n' "$1"
	shift
	[ $# -gt 0 ] && printf '%s\n' "$@"
	return 0
}

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
	echo "git リポジトリの中で実行してください。" >&2
	exit 3
}
cd "$root" || exit 3

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
node --check scripts/quality-check.cjs   # 構文（Node 版）
node scripts/quality-check.cjs           # 実際に走らせる
echo "exit=$?"
```

bash 版は `bash -n scripts/quality-check.sh` で構文を見てから `bash scripts/quality-check.sh` を走らせ、`chmod +x` を付けておく。

**わざと落としてみる。** 指摘が出る状態を作って `1` が返るか、依存を外して `3` が返るか。
通る場合しか試していないチェックは、落ちるべきときに落ちない。

## 一部を外したいとき

共通チェックの個別項目はリポジトリ直下の `.harness.json` で外せる。

```json
{ "checks": { "branch-name": false } }
```

外せるのは `conflict-markers` / `secrets` / `branch-name` / `issue-exists` / `quality-check`。
**プロジェクト側のチェックの中身は自分で書いたものなので、要らない項目は消せばよい。** ファイルごと無くすと、
共通チェックの `quality-check` が送信を止める。走らせるものが無いリポジトリは、ユーザーに確認したうえで `quality-check` を外す。

## よくある言い訳

| 考え | 現実 |
| --- | --- |
| 「共通チェックに足すほうが早い」 | 共有物。書き換えるとこのリポジトリだけ更新が届かなくなる |
| 「テストは CI で走るからここでは要らない」 | CI は push のあと。ここは push の前。壊れたものが出ていかない担保になる |
| 「全ファイルを検査したほうが確実」 | 過去の指摘で新しい作業が止まる。これから出ていくものだけを見る |
| 「環境が無いときも 1 を返せばいい」 | AI が存在しない指摘を直そうとする。環境の問題は `3` |
| 「落ちる場合は試さなくても分かる」 | 落ちるべきときに落ちないチェックは、無いのと同じ |
| 「Windows は誰も使わないから bash でいい」 | 使う人が現れた時点で書き直しになる。迷ったら Node |

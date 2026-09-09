#!/bin/bash
# プロジェクト固有の品質チェック。ホストの Node.js で実行する。
#
#   bash scripts/quality-check.sh
#   RUN_E2E=1 bash scripts/quality-check.sh   # E2E も走らせる（Issue B 以降）
#
# 終了コード:
#   0  合格
#   1  品質上の問題を検出
#   3  環境の問題で実行できない

set -uo pipefail

findings=0

note() { printf '%s\n' "$*"; }
fail() {
	findings=$((findings + 1))
	printf '\n[NG] %s\n' "$1"
	shift
	[ $# -gt 0 ] && printf '%s\n' "$@"
	return 0
}

if ! repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
	echo "git リポジトリの中で実行してください。" >&2
	exit 3
fi
cd "$repo_root" || exit 3

if ! command -v node >/dev/null 2>&1; then
	echo "Node.js が見つかりません。" >&2
	exit 3
fi

if ! command -v npm >/dev/null 2>&1; then
	echo "npm が見つかりません。" >&2
	exit 3
fi

packages=(backend frontend e2e)

require_node_modules() {
	local dir="$1"
	if [ ! -f "$dir/package.json" ]; then
		fail "$dir/package.json がありません"
		return 1
	fi
	if [ ! -d "$dir/node_modules" ]; then
		fail "node_modules がありません: $dir" \
			"  cd $dir && npm ci を実行してください。"
		return 1
	fi
	return 0
}

run_npm_script() {
	local dir="$1"
	local script="$2"
	local label="$3"

	note "==> $label ($dir: npm run $script)"
	if ! (cd "$dir" && npm run "$script"); then
		fail "$label に失敗しました ($dir: npm run $script)"
	fi
}

for dir in "${packages[@]}"; do
	require_node_modules "$dir" || true
done

if [ "$findings" -gt 0 ]; then
	printf '\nプロジェクト品質チェック: %d 件の環境問題があります。\n' "$findings"
	exit 3
fi

for dir in "${packages[@]}"; do
	run_npm_script "$dir" format:check "Prettier"
done

if [ -f compose.yaml ]; then
	prettier_bin=""
	for dir in backend frontend e2e; do
		if [ -x "$dir/node_modules/.bin/prettier" ]; then
			prettier_bin="$dir/node_modules/.bin/prettier"
			break
		fi
	done
	if [ -n "$prettier_bin" ]; then
		note "==> Prettier (リポジトリ直下の compose / CI)"
		root_targets=(compose.yaml)
		[ -f compose.override.yaml ] && root_targets+=(compose.override.yaml)
		if [ -d .github/workflows ]; then
			for workflow in .github/workflows/*; do
				[ -f "$workflow" ] && root_targets+=("$workflow")
			done
		fi
		if ! "$prettier_bin" --check "${root_targets[@]}"; then
			fail "Prettier に失敗しました (リポジトリ直下)"
		fi
	fi
fi

for dir in "${packages[@]}"; do
	run_npm_script "$dir" lint "ESLint"
done

for dir in "${packages[@]}"; do
	run_npm_script "$dir" typecheck "型チェック"
done

# DB を使わないテスト。
run_npm_script backend test:unit "ユニットテスト"
run_npm_script frontend test "コンポーネントテスト"

# API 統合テストとリポジトリのテストは実 MySQL に当てる（07-development.md 4章）。
# 落ちている場合は自分で起こす。「繋がらないので飛ばす」をしない。
if ! command -v docker >/dev/null 2>&1; then
	echo "Docker が見つかりません。統合テストに MySQL が要ります。" >&2
	exit 3
fi

note "==> MySQL を起動 (docker compose up -d mysql --wait)"
if ! docker compose up -d mysql --wait >/dev/null 2>&1; then
	echo "MySQL を起動できません。docker compose up -d mysql --wait を手で試してください。" >&2
	exit 3
fi

run_npm_script backend test:integration "API 統合テスト"

# E2E はブラウザの起動を待つので、既定では走らせない。
# フックは git commit にも掛かるため、TDD の細かいコミットが毎回待たされる。
# PR を出す前に一度 RUN_E2E=1 で通す（07-development.md 5.1）。
if [ "${RUN_E2E:-0}" = "1" ]; then
	run_npm_script e2e test "E2E"
fi

if [ "$findings" -gt 0 ]; then
	printf '\nプロジェクト品質チェック: %d 件の指摘があります。\n' "$findings"
	exit 1
fi

echo "プロジェクト品質チェック: 指摘はありません。"
exit 0

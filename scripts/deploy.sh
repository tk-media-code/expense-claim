#!/bin/bash
#
# ローカルでビルドした Docker イメージを EC2 へ配置し、Docker Compose で起動するスクリプト。
#
# なぜローカルでビルドするか:
#   EC2 は t3.micro（メモリ 1GB）で、nginx イメージのビルドに含まれる nuxt generate が
#   載らない。したがって「ローカルでビルドしてイメージだけ送る」形にしている。
#   ECR を使わないのは、docker save | ssh docker load で足りるためである。
#
# 接続情報を terraform output から取るのはなぜか:
#   IP アドレス・RDS のエンドポイント・パスワードを人が手で打ち写すと、
#   接続できない原因の大半がその打ち間違いになる。読み取り元を 1 つに固定して、
#   打ち写す工程そのものをなくしている。
#
# terraform apply をこのスクリプトに含めない理由:
#   apply の前に plan の内容を人が読む、という工程を飛ばさないため。
#
# 終了コードの意味:
#   0: 成功
#   1: デプロイに失敗した
#   3: そもそも実行できない（インフラ未構築・鍵が無い・EC2 に届かないなど環境側の問題）
#
# EC2 に置く環境変数の秘密情報の渡し方:
#   infra/files/env.ec2.op（1Password の参照だけを書いた雛形）を op inject で解決して、
#   EC2 の .env に置く。実行のたびに 1Password の承認が 1 回要る。
#   1Password を使わない人は ENV_FILE=<平文のファイル> を付ける（そのファイルを読む）。
#   OP_CMD で 1Password CLI を差し替えられる（既定は op.exe があれば op.exe（WSL）、無ければ op）。
#
# 使い方:
#   bash scripts/deploy.sh --all       # images → env → db-init → migrate → up の順に実行する
#   bash scripts/deploy.sh --images    # ローカルで 2 つのイメージをビルドして転送する
#   bash scripts/deploy.sh --env       # .env（雛形を 1Password で解決する）と compose.yaml を配置する
#   bash scripts/deploy.sh --db-init   # 照合順序を指定してデータベースを作る（冪等）
#   bash scripts/deploy.sh --migrate   # drizzle-kit migrate を流す（冪等）
#   bash scripts/deploy.sh --up        # docker compose up -d して /api/health を待つ

set -uo pipefail

# --- 0. 設定 ---

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$REPO_ROOT/infra"

# EC2 に配る環境変数の雛形。値は 1Password の参照で、実行時に解決する
readonly ENV_TEMPLATE="$INFRA_DIR/files/env.ec2.op"
# 1Password を使わないときの平文のファイル。環境変数で渡されたときだけ使う
readonly ENV_FILE="${ENV_FILE:-}"
readonly REMOTE_DIR="/home/ec2-user/expense-claim"
readonly BACKEND_IMAGE="expense-claim-backend"
readonly NGINX_IMAGE="expense-claim-nginx"
readonly SSH_KEY="${SSH_KEY:-$HOME/.ssh/expense-claim-ec2.pub}"

readonly EXIT_OK=0
readonly EXIT_FAILURE=1
readonly EXIT_ENV_ERROR=3

# --- 1. ユーティリティ ---

info() { echo "[$(date +%H:%M:%S)] $*"; }
fail() { echo "[エラー] $*" >&2; }

# terraform output から 1 つの値を取り出す。
# インフラが未構築ならここで失敗するので、以降の処理に進まない。
tf_output() {
	terraform -chdir="$INFRA_DIR" output -raw "$1" 2>/dev/null
}

# イメージのタグ。git の short SHA を使う。
# latest 固定だと「転送したつもりが古いイメージのまま」という状態に気づけない。
# 作業ツリーに未コミットの変更があれば -dirty を付け、配置物とコミットの対応を曖昧にしない。
image_tag() {
	local tag
	tag="$(git -C "$REPO_ROOT" rev-parse --short HEAD)" || return 1
	if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
		tag="$tag-dirty"
	fi
	echo "$tag"
}

# 使う 1Password CLI。OP_CMD があればそれ、無ければ op.exe（WSL）、無ければ op。
# WSL では op.exe を使う。Windows 側の 1Password アプリと Windows Hello で承認するため。
op_cmd() {
	if [ -n "${OP_CMD:-}" ]; then
		echo "$OP_CMD"
	elif command -v op.exe >/dev/null 2>&1; then
		echo op.exe
	else
		echo op
	fi
}

# EC2 に置く環境変数の行を標準出力に出す。失敗したら 0 以外を返し、何も出さない。
# ENV_FILE があればその中身。無ければ ENV_TEMPLATE を 1Password で解決した結果。
# 解決した結果はディスクに書かない（変数と pipe だけで扱う）。
resolve_env_source() {
	if [ -n "$ENV_FILE" ]; then
		cat "$ENV_FILE"
		return
	fi

	local op resolved unresolved
	op="$(op_cmd)"

	# op inject は {{ op://... }} だけを置き換える。雛形は op run --env-file と同じ書式
	# （値がまるごと参照の行）で書くので、ここで {{ }} で包む。
	# op.exe は行末に CR を付けるので落とす。CR が残ると値の末尾に混ざる。
	# 失敗（承認のタイムアウト・参照先が無いなど）のときは何も出さずに止まる。
	if ! resolved="$(sed -E 's#^([A-Za-z_][A-Za-z0-9_]*)=(op://.*)$#\1={{ \2 }}#' "$ENV_TEMPLATE" | "$op" inject | tr -d '\r')"; then
		fail "1Password での解決に失敗しました（$op inject）。"
		return 1
	fi

	# 参照先のアイテムやフィールドが無いと、参照がそのまま残ることがある。
	# 空や参照のままの値を EC2 に置くと、起動時に原因の分かりにくい失敗になるので、ここで止める。
	unresolved="$(printf '%s\n' "$resolved" | sed -n '/^[[:space:]]*#/d; /op:\/\//s/=.*//p')"
	if [ -n "$unresolved" ]; then
		fail "1Password の参照を解決できなかった変数があります。アイテム expense-claim-aws とフィールド名を確認してください:"
		printf '%s\n' "$unresolved" | sed 's/^/  /' >&2
		return 1
	fi

	printf '%s\n' "$resolved"
}

# リモートでコマンドを実行する。stdin はそのまま渡る。
remote() {
	ssh "${SSH_OPTS[@]}" "ec2-user@$HOST" "$@"
}

# 実行前の環境確認。コードではなく環境側の問題を、実行前にまとめて検出する。
# 引数: .env を使う工程を含むなら 1
preflight() {
	local need_env="$1"
	local cmd

	for cmd in terraform docker git ssh; do
		if ! command -v "$cmd" >/dev/null 2>&1; then
			fail "$cmd コマンドが見つかりません。"
			return 1
		fi
	done

	if [ ! -f "$INFRA_DIR/terraform.tfstate" ]; then
		fail "infra/terraform.tfstate がありません。先にインフラを構築してください。"
		echo "  terraform -chdir=infra apply" >&2
		return 1
	fi

	if [ ! -f "$SSH_KEY" ]; then
		fail "SSH の鍵が見つかりません: $SSH_KEY"
		echo "  鍵は 1Password の SSH エージェントに置き、公開鍵を ~/.ssh/expense-claim-ec2.pub に置いてください（infra/README.md の 1.）。" >&2
		echo "  秘密鍵ファイルを使うなら SSH_KEY=<秘密鍵のパス> を付けて実行してください。" >&2
		return 1
	fi

	if [ "$need_env" -eq 1 ]; then
		if [ -n "$ENV_FILE" ]; then
			if [ ! -f "$ENV_FILE" ]; then
				fail "ENV_FILE のファイルがありません: $ENV_FILE"
				return 1
			fi
		else
			if [ ! -f "$ENV_TEMPLATE" ]; then
				fail "EC2 に配る環境変数の雛形がありません: $ENV_TEMPLATE"
				return 1
			fi
			if ! command -v "$(op_cmd)" >/dev/null 2>&1; then
				fail "1Password CLI（$(op_cmd)）を実行できません。"
				echo "  1Password CLI を入れてください（WSL では Windows 側の op.exe を PATH に通します）。" >&2
				echo "  1Password を使わないなら、平文のファイルを ENV_FILE=<パス> で渡してください（infra/README.md の 3.）。" >&2
				return 1
			fi
			if [ -f "$INFRA_DIR/.env.ec2" ]; then
				echo "[注意] infra/.env.ec2 は使われません。EC2 に置く値は infra/files/env.ec2.op を 1Password で解決したものになりました。" >&2
				echo "  値を 1Password（アイテム expense-claim-aws）に移したら、infra/.env.ec2 は消してください。" >&2
				echo "  1Password を使わず使い続けるなら、ENV_FILE=infra/.env.ec2 を付けて実行してください。" >&2
			fi
		fi
	fi

	HOST="$(tf_output ec2_public_ip)"
	if [ -z "$HOST" ]; then
		fail "EC2 の IP アドレスを取得できません。インフラが構築済みか確認してください。"
		return 1
	fi

	TAG="$(image_tag)"
	if [ -z "$TAG" ]; then
		fail "git のコミットを取得できません。"
		return 1
	fi

	# StrictHostKeyChecking=accept-new を使う理由:
	# apply のたびに IP もホスト鍵も変わりうるため、未知のホストは自動で受け入れる。
	# 既知の IP で鍵だけが変わった場合は警告が出るので、そのときは
	# ssh-keygen -R <IP> で古い記録を消す。
	# IdentitiesOnly=yes を使う理由:
	# -i に公開鍵を渡すと、ssh はその鍵をエージェントに署名させる。IdentitiesOnly=yes は、
	# 指定の鍵が通らないとき（エージェントに無い・EC2 に未登録）に、エージェントの他の鍵まで
	# EC2 に順に見せないためのもの。見せると MaxAuthTries で切られ、原因の分かりにくい失敗になる。
	# ServerAliveInterval は、イメージ転送（数分）の間に接続を切られないための指定。
	SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30)

	if ! remote 'true' 2>/dev/null; then
		fail "EC2 に接続できません: ec2-user@$HOST"
		echo "  セキュリティグループの SSH 許可元（ssh_allowed_cidr）が現在の IP と一致しているか確認してください。" >&2
		echo "  現在の IP: $(curl -s https://checkip.amazonaws.com 2>/dev/null)" >&2
		echo "  鍵がエージェントに載っているか（ssh-add -l）と、1Password がロックされていないかも確認してください。" >&2
		echo "  ~/.ssh/config の IdentityAgent でエージェントを使っているなら、SSH_AUTH_SOCK にそのソケットを指定して ssh-add -l を実行します。" >&2
		echo "  例: SSH_AUTH_SOCK=~/.1password/agent.sock ssh-add -l（Linux の 1Password の既定の場所。macOS では場所が違います）" >&2
		echo "  秘密鍵ファイルを使うなら SSH_KEY=<秘密鍵のパス> を付けて実行してください。" >&2
		return 1
	fi

	# user-data（Docker と Compose プラグインの導入）が終わるまで待つ。初回は数分かかる。
	# ec2-user の docker グループも、この完了後の新しい ssh セッションから効く。
	info "EC2 の初期化（cloud-init）の完了を待ちます"
	if ! remote 'sudo cloud-init status --wait >/dev/null'; then
		fail "EC2 の初期化に失敗しています。EC2 上の /var/log/cloud-init-output.log を確認してください。"
		return 1
	fi

	if ! remote 'docker compose version >/dev/null'; then
		fail "EC2 上で docker compose が使えません。/var/log/cloud-init-output.log を確認してください。"
		return 1
	fi

	return 0
}

# --- 2. イメージのビルドと転送 ---

deploy_images() {
	info "イメージをビルドします（タグ: $TAG）"

	# --platform を明示する。ローカルも EC2 も x86_64 だが、別のマシンでビルドしたときに
	# アーキテクチャ不一致のイメージが黙って出来上がるのを防ぐ。
	if ! docker build --platform linux/amd64 -t "$BACKEND_IMAGE:$TAG" "$REPO_ROOT/backend"; then
		fail "backend のビルドに失敗しました。"
		return 1
	fi

	# nginx イメージは frontend を含むので、ビルドコンテキストはリポジトリ直下（compose.yaml と同じ）
	if ! docker build --platform linux/amd64 -t "$NGINX_IMAGE:$TAG" -f "$REPO_ROOT/nginx/Dockerfile" "$REPO_ROOT"; then
		fail "nginx（frontend を含む）のビルドに失敗しました。"
		return 1
	fi

	info "イメージを転送します（圧縮後およそ 260MB。数分かかります）"

	# 2 つのイメージを 1 本の tar にまとめる。共有するレイヤは 1 回しか入らない。
	# docker load は gzip を自動的に判別して展開する。
	if ! docker save "$BACKEND_IMAGE:$TAG" "$NGINX_IMAGE:$TAG" | gzip -1 | remote 'docker load'; then
		fail "イメージの転送に失敗しました。"
		return 1
	fi

	# 古いタグのイメージを掃除する。16GB のディスクを食い潰さないため
	remote 'docker image prune -f >/dev/null'
	return 0
}

# --- 3. 設定ファイルの配置 ---

# .env と compose.yaml を EC2 に置く。冪等で数秒で終わるので、
# 以降の工程はどれも最初にこれを呼ぶ。TAG が古いまま up する事故を防ぐため。
ENV_DEPLOYED=0
deploy_env() {
	[ "$ENV_DEPLOYED" -eq 1 ] && return 0

	info "設定ファイルを配置します"

	local database_url app_url env_source
	database_url="$(tf_output database_url)"
	app_url="$(tf_output app_url)"
	if [ -z "$database_url" ] || [ -z "$app_url" ]; then
		fail "terraform output から接続情報を取得できません。"
		return 1
	fi

	# 環境変数は先に全部解決してから、まとめて EC2 に流す。
	# 流しながら解決すると、解決の失敗（承認のタイムアウトなど）で途中までしか書かれず、
	# EC2 の .env が半端な内容になる。先に解決すれば、失敗したら remote を呼ばずに止まり、
	# EC2 の .env は前の内容のまま残る。
	if [ -z "$ENV_FILE" ]; then
		info "環境変数を 1Password で解決します（承認を求められたら承認してください）"
	fi
	if ! env_source="$(resolve_env_source)"; then
		fail "環境変数を用意できませんでした。EC2 の .env は変更していません。"
		return 1
	fi

	# umask 077 でファイルを 600 にしてから書き出す。値はコマンドラインに載せず stdin で渡す。
	# DATABASE_URL・TAG・APP_URL は terraform output と git から合成するので、
	# 雛形（または ENV_FILE）に同名の行があっても捨てる。
	if ! {
		printf 'TAG=%s\nDATABASE_URL=%s\nAPP_URL=%s\n' "$TAG" "$database_url" "$app_url"
		printf '%s\n' "$env_source" | grep -v -E '^(TAG|DATABASE_URL|APP_URL)=' || true
	} | remote "umask 077 && cat > $REMOTE_DIR/.env"; then
		fail ".env の配置に失敗しました。"
		return 1
	fi

	if ! remote "cat > $REMOTE_DIR/compose.yaml" <"$INFRA_DIR/files/compose.ec2.yaml"; then
		fail "compose.yaml の配置に失敗しました。"
		return 1
	fi

	ENV_DEPLOYED=1
	return 0
}

# --- 4. データベースの作成 ---

deploy_db_init() {
	deploy_env || return 1

	info "データベースを作ります（照合順序 utf8mb4_ja_0900_as_cs）"

	# backend イメージの中の mysql2 で RDS に繋ぐ。理由は infra/files/db-init.mjs 冒頭のコメント。
	# コンテナを起動する前に、まずここで「EC2 から RDS に届くか」を確定させる。
	# 先にアプリを起動してしまうと、起動失敗の原因が「ネットワーク」「認証情報」「コンテナ」の
	# どれなのか切り分けられなくなる。
	if ! remote "cd $REMOTE_DIR && docker compose run --rm -T --no-deps backend node --input-type=module -" \
		<"$INFRA_DIR/files/db-init.mjs"; then
		fail "データベースの作成に失敗しました。"
		echo "  接続で固まる／ETIMEDOUT: RDS 側の SG が EC2 の SG を参照しているか、サブネットグループを確認" >&2
		echo "  ENOTFOUND: VPC の enable_dns_hostnames" >&2
		echo "  Access denied: terraform.tfvars の db_password を apply 後に変えていないか" >&2
		echo "  到達性だけを見るには EC2 上で: timeout 5 bash -c '</dev/tcp/$(tf_output db_host)/3306' && echo ok" >&2
		return 1
	fi
	return 0
}

# --- 5. マイグレーション ---

deploy_migrate() {
	deploy_env || return 1

	info "マイグレーションを流します"

	# drizzle-kit は適用済みの SQL を __drizzle_migrations で管理するので、何度流しても差分だけが当たる
	if ! remote "cd $REMOTE_DIR && docker compose run --rm -T --no-deps backend npm run db:migrate"; then
		fail "マイグレーションに失敗しました。先に --db-init でデータベースを作ってください。"
		return 1
	fi
	return 0
}

# --- 6. 起動 ---

deploy_up() {
	deploy_env || return 1

	info "コンテナを起動します"

	# pull_policy: never（compose.yaml）なので、.env の TAG に対応するイメージが
	# 転送されていなければここで止まる。黙って古いイメージで動くことはない。
	if ! remote "cd $REMOTE_DIR && docker compose up -d --remove-orphans"; then
		fail "起動に失敗しました。イメージが未転送なら --images を先に実行してください。"
		return 1
	fi

	info "アプリケーションの起動を待ちます"

	# nginx 越しに health が通るまで待つ。nginx → backend の配線まで含めて確認できる。
	# ここで待たずに終了すると、直後の動作確認が 502 になって
	# 「デプロイに失敗した」と誤解する原因になる。
	local _
	for _ in $(seq 1 30); do
		if remote 'curl -sf http://127.0.0.1/api/health >/dev/null 2>&1'; then
			info "アプリケーションが応答しました"
			return 0
		fi
		sleep 3
	done

	fail "アプリケーションが起動しませんでした。ログを確認してください:"
	echo "  ssh -i $SSH_KEY -o IdentitiesOnly=yes ec2-user@$HOST 'cd $REMOTE_DIR && docker compose ps && docker compose logs --tail 50 backend'" >&2
	return 1
}

# --- 7. 引数の解釈と実行 ---

usage() {
	sed -n '/^# 使い方:/,/--up/p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
	local do_images=0 do_env=0 do_db_init=0 do_migrate=0 do_up=0

	if [ $# -eq 0 ]; then
		usage
		return $EXIT_ENV_ERROR
	fi

	while [ $# -gt 0 ]; do
		case "$1" in
		--all) do_images=1 do_env=1 do_db_init=1 do_migrate=1 do_up=1 ;;
		--images) do_images=1 ;;
		--env) do_env=1 ;;
		--db-init) do_db_init=1 ;;
		--migrate) do_migrate=1 ;;
		--up) do_up=1 ;;
		-h | --help)
			usage
			return $EXIT_OK
			;;
		*)
			fail "不明な引数: $1"
			usage
			return $EXIT_ENV_ERROR
			;;
		esac
		shift
	done

	local need_env=0
	if [ "$do_env" -eq 1 ] || [ "$do_db_init" -eq 1 ] || [ "$do_migrate" -eq 1 ] || [ "$do_up" -eq 1 ]; then
		need_env=1
	fi

	if ! preflight "$need_env"; then
		return $EXIT_ENV_ERROR
	fi

	info "デプロイ先: $HOST（タグ: $TAG）"

	if [ "$do_images" -eq 1 ] && ! deploy_images; then
		return $EXIT_FAILURE
	fi
	if [ "$do_env" -eq 1 ] && ! deploy_env; then
		return $EXIT_FAILURE
	fi
	if [ "$do_db_init" -eq 1 ] && ! deploy_db_init; then
		return $EXIT_FAILURE
	fi
	if [ "$do_migrate" -eq 1 ] && ! deploy_migrate; then
		return $EXIT_FAILURE
	fi
	if [ "$do_up" -eq 1 ] && ! deploy_up; then
		return $EXIT_FAILURE
	fi

	echo
	info "完了しました: $(tf_output app_url)"
	return $EXIT_OK
}

# source されたときは走らせない（確認用に関数だけを読み込めるようにする）
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	main "$@"
fi

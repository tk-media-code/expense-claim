#!/bin/bash
#
# EC2 の初回起動時に cloud-init が root 権限で一度だけ実行するスクリプト。
#
# ここで行うのは「OS に何を入れるか」までに限定している。
# compose.yaml・.env・Docker イメージは scripts/deploy.sh が配る。
#
# 理由は、user_data が「一度しか実行されない」性質を持つためである。
# 内容を変更してもインスタンス内で再実行されることはなく、
# Terraform 側で user_data_replace_on_change = true を指定しているため
# 変更＝インスタンスの作り直し（IP も変わる）になる。
# アプリ側の設定は試行錯誤で何度も直すものなので、ここに含めると苦痛になる。
#
# 実行ログは /var/log/cloud-init-output.log に残る。
# 起動後に何かがおかしいときは、まずこのファイルを見ること。

set -euxo pipefail

# Docker Compose プラグインの版。
# Amazon Linux 2023 の dnf には compose プラグインが無いので、GitHub のリリースから入れる。
# 版を固定しているのは、同じ user-data から同じ環境が立つようにするため。
# ".../releases/latest/download/docker-compose-linux-x86_64" でも動く。
# もし Docker Engine との相性で動かなければ、ローカルと同じ v2.36.2 に落とす。
COMPOSE_VERSION=v5.5.1

dnf update -y

# docker: nginx / backend / scheduler の 3 コンテナを動かす。
# nginx も Node.js もホストには入れない（すべてコンテナの中にある）。
dnf install -y docker

# Compose プラグイン。/usr/local/lib/docker/cli-plugins は Docker CLI が
# システム全体のプラグインを探す場所で、ec2-user からも見える。
install -d -m 755 /usr/local/lib/docker/cli-plugins
curl -fsSL --retry 5 --retry-delay 5 \
	-o /usr/local/lib/docker/cli-plugins/docker-compose \
	"https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)"
chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose

# 2GB のスワップ領域。
# t3.micro はメモリが 1GB しかなく、OS・dockerd に加えて node のプロセスが
# 2 つ（backend と scheduler。どちらも googleapis を読み込む）載る。
# EBS 上のスワップは遅いが、メモリ不足で OOM Killer にコンテナを落とされるよりはましである。
if [ ! -f /swapfile ]; then
	dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	# 再起動後も有効にする
	echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# --now を付けると「自動起動の有効化」と「今すぐ起動」を同時に行う
systemctl enable --now docker

# ec2-user が sudo なしで docker を使えるようにする。
# グループの変更は「新しいログインセッション」からしか反映されないため、
# このスクリプトと同じセッション内では反映されない。
# deploy.sh は毎回 ssh で接続し直すので問題にならない。
usermod -aG docker ec2-user

# deploy.sh が compose.yaml と .env を置く場所。
# .env には秘密が入るので、ディレクトリごと ec2-user 以外から見えなくしておく。
install -d -m 700 -o ec2-user -g ec2-user /home/ec2-user/expense-claim

# 最後に自己検証する。ここで失敗すれば set -e により cloud-init が error になり、
# deploy.sh の preflight（cloud-init status --wait）で気づける。
docker compose version

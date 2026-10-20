# infra/ — AWS 環境の構築

このディレクトリは、交通費精算アプリを AWS 上に構築する Terraform の構成です。
前回のスクール課題（task-management）の Terraform を引き継いでいます（[`docs/design/01-architecture.md`](../docs/design/01-architecture.md) 3.8）。

- **AWS や Terraform そのものの解説**は前回のリポジトリ `task-management/docs/aws/`・`docs/terraform/` にあります
- ここに書くのは、この構成を**実際に動かすための手順**です

---

## この構成の前提

**動作確認できたら `terraform destroy` で消す**ことを前提に設計しています。長期運用を想定した構成ではありません。

### 全体像

```
Internet ──HTTP(80・自分の IP のみ)──▶ EC2 t3.micro (Amazon Linux 2023)
                                       └ Docker Compose（~/expense-claim/compose.yaml）
                                          ├ nginx     : /     → 静的ファイル（イメージに焼き込み済み）
                                          │             /api/ → backend:3000
                                          ├ backend   : Hono の API（GOOGLE_STUB=1）
                                          └ scheduler : 提出アラート（backend と同じイメージ・別コマンド）
                                                  │ 3306（EC2 のセキュリティグループからのみ）
                                                  ▼
                                       RDS db.t4g.micro (MySQL 8.4)
                                       プライベートサブネット / 外部から接続不可
```

EC2 のホストには Docker と Compose プラグインだけを入れます。nginx も Node.js もホストには入れず、すべてコンテナの中で動きます。フロントエンドはビルド成果物を nginx のイメージに焼き込んであるので、実行時のコンテナは 3 つです（[`01-architecture.md`](../docs/design/01-architecture.md) 4.2）。

イメージは**ローカルでビルドして転送**します（`docker save | ssh docker load`）。t3.micro（メモリ 1GB）では `nuxt generate` が載らないためです。

### 意図的に実装していないもの

| 項目 | 理由 |
| --- | --- |
| **HTTPS・ドメイン** | 数日で消す環境のため。証明書とドメインを持たない |
| **実物の Google への接続** | Google のウェブアプリ型 OAuth はリダイレクト URI に https とドメイン名を要求し、生 IP・http では通らない。そのため `GOOGLE_STUB=1` で動かす（下記） |
| 予算アラート | アカウントに前回の `task-management-monthly`（$10/月）が残っており、アカウント単位で効いている |
| ALB | 月 18 ドル程度かかる。nginx が同じ役割を果たせる |
| NAT Gateway | 月 45 ドル程度かかる。RDS は外部への発信をしないため不要 |
| Elastic IP | 停止・起動をしなければ IP は変わらない。EIP は未使用時も課金される |
| ECR | イメージは `docker save` で直接転送すれば足りる |

> ⚠️ **`GOOGLE_STUB=1` の意味**
> スタブのログインは Google へ行かず、**誰であっても許可アドレス本人として通します。**
> つまり 80 番に届く人は誰でもログインして操作できる状態です。
> このため `http_allowed_cidrs` は必須で、`0.0.0.0/0` を指定できないようにしてあります（`variables.tf`）。
> 提出・メール・ドライブはスタブが受け止めるので、実物のシートやメールには何も起きません。

### コストの目安

t3.micro（約 $0.0136/h）+ db.t4g.micro（約 $0.026/h）+ パブリック IPv4（$0.005/h）+ EBS/RDS ストレージで、**1 日あたり 150 円前後**です。確認が終わったら早めに destroy します。

---

## 初回セットアップ

### 1. SSH 鍵を作る

鍵は 1Password の SSH エージェントに置きます。秘密鍵がファイルとしてディスクに残りません。

1. 1Password で新規アイテム → SSH キー → 「Ed25519」で生成する。タイトルは `expense-claim-ec2`。保管庫は、SSH エージェントが鍵を出す保管庫（`agent.toml` の対象）にする
2. アイテムの公開鍵を `~/.ssh/expense-claim-ec2.pub` に保存する
3. ssh が使うエージェントに `expense-claim-ec2` が載っていることを確かめる。ssh は `SSH_AUTH_SOCK` か、`~/.ssh/config` の `IdentityAgent` でエージェントを使う設定にしておく。確かめ方は次の 2 通り
   - `IdentityAgent` を設定していないなら、そのまま `ssh-add -l`
   - `IdentityAgent` を設定しているなら、そのソケットを `SSH_AUTH_SOCK` に指定して実行する（例: `SSH_AUTH_SOCK=~/.1password/agent.sock ssh-add -l`。Linux の 1Password の既定の場所で、macOS では場所が違う）。両方あるときは ssh では `IdentityAgent` が勝つので、素の `ssh-add -l` では違う一覧を見ることがある

**公開鍵だけ**を Terraform が AWS に登録します。Terraform に鍵そのものを生成させると、秘密鍵が state に平文で保存されてしまうため、この手順は手作業で行います。`deploy.sh` は `~/.ssh/expense-claim-ec2.pub` を指定して ssh を呼び、署名はエージェントが行います。

1Password を使わない場合は、従来どおり `ssh-keygen` で鍵を作り、`deploy.sh` に秘密鍵のパスを渡します。手で打つ `ssh -i` も、`.pub` ではなく秘密鍵のパスにします（エージェントに鍵が無いと、ssh は公開鍵ファイルを秘密鍵として読もうとして失敗します）。

```bash
ssh-keygen -t ed25519 -f ~/.ssh/expense-claim-ec2 -C "expense-claim deploy" -N ''
SSH_KEY=~/.ssh/expense-claim-ec2 bash scripts/deploy.sh --all
```

前回の鍵を使い回すなら `terraform.tfvars` の `ssh_public_key_path` と、`deploy.sh` の `SSH_KEY` 環境変数で指定します。

### 2. 変数ファイルを用意する

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

編集に必要な値は次のとおりです。

```bash
# 自分のグローバル IP（SSH と HTTP の許可元に使う）
curl -s https://checkip.amazonaws.com
```

RDS のマスターパスワード（`db_password`）は `terraform.tfvars` に書きません。平文の値を持つファイルをディスクに残さないためです（state には今も平文で入るので、`terraform.tfstate` と `.backup` は秘密として扱います）。値は 1Password に置き、雛形 [`terraform.op`](terraform.op) から環境変数 `TF_VAR_db_password` として Terraform に渡します。値は英数字のみ 16〜41 文字です（理由は `variables.tf` のコメント参照）。1Password のアイテムは次の手順 3 で作るので、ここでは値を作るだけにします。

```bash
# DB のパスワードを作る。手順 3 のアイテムのフィールド db-password に入れる
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24; echo
```

`terraform.tfvars` に `db_password` の行が残っていれば消します（tfvars は環境変数より優先されるため、残っていると 1Password の値が使われません）。

### 3. EC2 に配る環境変数を用意する

EC2 に置く秘密情報は 1Password に置きます。リポジトリにあるのは参照だけを書いた雛形 [`files/env.ec2.op`](files/env.ec2.op) で、`deploy.sh` が実行のたびにこれを 1Password で解決して EC2 の `.env` に置きます。値のファイルがディスクに残りません。

1Password の tk-media 保管庫に、アイテム `expense-claim-aws`（SSH キー `expense-claim-ec2` とは別のアイテム）を作り、次の 3 つのフィールドに値を入れます。`session-secret` と `token-encryption-key` には `openssl rand -hex 32` で作った値を、`db-password` には手順 2 で作った値を入れます。

| フィールド | 用途 |
| --- | --- |
| `session-secret` | セッション Cookie の署名鍵（`SESSION_SECRET`） |
| `token-encryption-key` | リフレッシュトークンの暗号鍵（`TOKEN_ENCRYPTION_KEY`） |
| `db-password` | RDS のマスターパスワード（`TF_VAR_db_password`。`terraform.op` が参照する。`env.ec2.op` からは参照しない。EC2 には terraform output の `database_url` に含まれて届く） |

```bash
openssl rand -hex 32
```

`deploy.sh` は `--env` を含む実行のたびに、1Password の承認を 1 回求めます（WSL では `op.exe` を使い、Windows Hello で承認します）。1Password CLI は、`op.exe` があれば `op.exe`、無ければ `op` を使います。

1Password を使わない場合は、雛形を写して参照を実値に置き換え、そのファイルを `ENV_FILE` で渡します。`.env.` で始まる名前（`infra/.env.ec2` など）にすると `.gitignore` に除外されます。`.env-ec2` や `.env_ec2` は除外されないので使わないでください。

```bash
cp infra/files/env.ec2.op infra/.env.ec2
# 参照（op://...）を openssl rand -hex 32 で作った値に置き換える
ENV_FILE=infra/.env.ec2 bash scripts/deploy.sh --all
```

置き換え忘れて `op://` が残っていると、`deploy.sh` は変数名を出して止まります。`SESSION_SECRET` と `TOKEN_ENCRYPTION_KEY` に値のある行が無いときも止まります（参照の文字列は長さの検証を通るので、止めないと公開済みの文字列が鍵のまま EC2 に置かれます）。

`*.tfvars` は `.gitignore` 済みでコミットされません。

---

## 構築の手順

**`terraform apply` は必ず `plan` の内容を読んでから実行してください。** `-auto-approve` は使いません。

`db_password` は 1Password から渡すので、`plan` と `apply` は [`terraform.op`](terraform.op) を通して実行します。WSL では `oprun`（`op.exe inject` を通すラッパー。リポジトリには含まれず、作りは [`google.op`](../google.op) の冒頭に書いてある。`op run` と同じく出力の秘密の値をマスクし、先頭の `--no-masking` で外せる前提）、ほかの OS では `op run` を使います。

```bash
terraform -chdir=infra init
oprun infra/terraform.op -- terraform -chdir=infra plan -input=false    # 何が作られるかを読む
oprun --no-masking infra/terraform.op -- terraform -chdir=infra apply   # RDS の作成に 5〜10 分かかる

# WSL 以外は oprun を op run に読み替える
# op run --env-file=infra/terraform.op -- terraform -chdir=infra plan -input=false
# op run --no-masking --env-file=infra/terraform.op -- terraform -chdir=infra apply
```

`apply` は確認の入力を求める対話なので、出力のマスクを外します（`--no-masking`）。

`plan` を読むときに特に見るべき点：

- `Plan: X to add, Y to change, Z to destroy.` の **Z**。0 でなければ何が消えるのかを確認する
- **`-/+`（作り直し）** の対象。DB がこれになっていたら中身が消える
- `database_url` と `db_password` が `(sensitive value)` で伏せられていること

### 構築後の確認

```bash
terraform -chdir=infra output          # 接続情報の一覧
IP=$(terraform -chdir=infra output -raw ec2_public_ip)

# EC2 に入り、初期化の完了を待つ（dnf update を含むので初回は数分かかる）
ssh -i ~/.ssh/expense-claim-ec2.pub -o IdentitiesOnly=yes ec2-user@$IP 'sudo cloud-init status --wait && docker compose version'
```

`docker compose version` が版を返せば、Docker・Compose プラグイン・ec2-user の docker グループがすべて揃っています。失敗したら EC2 上の `/var/log/cloud-init-output.log` を見ます。

**RDS への到達性は `deploy.sh --db-init` が最初に確かめます**（次節）。コンテナを起動する前にここを通しておくと、アプリが動かないときに「ネットワークの問題」「認証情報の問題」「コンテナの問題」を切り分けられます。

---

## アプリケーションの配置

インフラが構築できたら、`scripts/deploy.sh` でアプリを配置します。

```bash
bash scripts/deploy.sh --all       # 下の 5 工程を順に実行する
bash scripts/deploy.sh --images    # ローカルで 2 つのイメージをビルドして転送する
bash scripts/deploy.sh --env       # .env と compose.yaml を配置する
bash scripts/deploy.sh --db-init   # 照合順序を指定してデータベースを作る（冪等）
bash scripts/deploy.sh --migrate   # drizzle-kit migrate を流す（冪等）
bash scripts/deploy.sh --up        # docker compose up -d して /api/health を待つ
```

接続先の IP や DB のパスワードは `terraform output` から自動で読み取るため、手で打ち込む必要はありません。`--db-init`・`--migrate`・`--up` は内部で `--env` も毎回実行します。

| 工程 | 何をするか | 所要時間の目安 |
| --- | --- | --- |
| `--images` | `backend/` と `nginx/Dockerfile`（frontend を含む）をローカルで `linux/amd64` としてビルドし、`docker save \| gzip \| ssh docker load` で転送する。イメージのタグは git の short SHA | ビルド数分 + 転送 260MB |
| `--env` | `infra/files/env.ec2.op` を 1Password で解決したものに `DATABASE_URL`・`TAG`・`APP_URL` を足して EC2 の `~/expense-claim/.env`（600）に置き、`compose.ec2.yaml` を `~/expense-claim/compose.yaml` として置く | 数秒 |
| `--db-init` | backend イメージの中で [`files/db-init.mjs`](files/db-init.mjs) を実行し、`CREATE DATABASE ... COLLATE utf8mb4_ja_0900_as_cs` する。作ったあと照合順序を読み返し、違えば失敗する | 数秒 |
| `--migrate` | `docker compose run --rm backend npm run db:migrate` | 数秒 |
| `--up` | `docker compose up -d` して nginx 越しに `/api/health` が返るまで待つ | 30 秒ほど |

### データベースを自分で作る理由

RDS に初期データベースを作らせると、照合順序がサーバー既定の `utf8mb4_0900_ai_ci` になります。このアプリは `utf8mb4_ja_0900_as_cs` を前提にしており（[`03-database.md`](../docs/design/03-database.md) 4.1。既定の `ai_ci` は濁点を区別せず、駅名の UNIQUE 制約が壊れる）、マイグレーション SQL は照合順序を持たずデータベースの既定を継承します。そのため Terraform では作らせず（`database.tf`）、`--db-init` が照合順序を明示して作ります。

### 配置後の確認

```bash
IP=$(terraform -chdir=infra output -raw ec2_public_ip)

curl -s -o /dev/null -w '%{http_code}\n' "http://$IP/"           # 200
curl -s "http://$IP/api/health"                                   # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' "http://$IP/settings"   # 200（SPA フォールバック）
curl -s "http://$IP/api/home"                                     # 401 の共通エラー形式
curl --max-time 5 "http://$IP:3000/api/health"                    # 接続不可であること
```

ブラウザで `http://$IP/login` を開き、「Google でログイン」を押すとスタブがそのままホームへ戻します。駅・区間・会場・案件を登録して RDS への読み書きを確かめます。

EC2 上では次を見ます。

```bash
ssh -i ~/.ssh/expense-claim-ec2.pub -o IdentitiesOnly=yes ec2-user@$IP
cd ~/expense-claim
docker compose ps                   # nginx / backend / scheduler が running
docker compose logs scheduler       # 起動時に 1 回走ったログ（DB に書けている証拠）
docker compose logs --tail 50 backend
```

照合順序は `bash scripts/deploy.sh --db-init` を再実行すると、データベースと全テーブル（`__drizzle_migrations` を含む）の照合順序が一覧で出ます。

E2E のうち `smoke` と `auth` は本番 IP に向けて流せます（`SESSION_SECRET` は EC2 に置いた値と同じにする。揃っていないと自署名の Cookie が無効になります）。

```bash
cd e2e && E2E_BASE_URL=http://$IP SESSION_SECRET="$(op read op://tk-media/expense-claim-aws/session-secret)" npx playwright test smoke auth
```

WSL では `op.exe read ... | tr -d '\r'` にします（`op.exe` は行末に CR を付けるため）。

### うまくいかないときは

| 症状 | 確認すること |
| --- | --- |
| `deploy.sh` が exit 3 で止まる | 環境側の問題。表示された案内に従う（tfstate が無い・鍵が無い・1Password CLI が無い・SSH が届かない・cloud-init が終わっていない） |
| SSH が届かない | `ssh_allowed_cidr` が現在の IP と一致しているか。`curl -s https://checkip.amazonaws.com` |
| `deploy.sh` が 1Password の解決で止まる（承認がタイムアウトした、`op` が失敗した） | 1Password アプリがロックされていないか、承認の画面（Windows Hello）が出ていないかを確かめて、`deploy.sh` をやり直す。止まったときは EC2 の `.env` を書き換えていない。やり直しても直らないときは、`op` のエラー表示を読み、1Password のアイテムやフィールドの名前が雛形と合っているか確かめる |
| `deploy.sh` が「1Password の参照を解決できなかった変数」を出して止まる | 表示された変数の参照先（`infra/files/env.ec2.op`）を確かめる。保管庫 `tk-media` のアイテム `expense-claim-aws` と、フィールド名（`session-secret`・`token-encryption-key`）が一致しているか |
| 接続確認で止まる（IP は合っている） | ssh が使うエージェントに `expense-claim-ec2` が載っているか。`IdentityAgent` を設定しているなら `SSH_AUTH_SOCK=<そのソケット> ssh-add -l`、そうでなければ `ssh-add -l`（手順 1 の 3.）。載っていなければ 1Password がロックされていないか、鍵の保管庫が SSH エージェントの対象かを確かめる。秘密鍵ファイルを使うなら `SSH_KEY=<秘密鍵のパス>` を付ける |
| ブラウザで開けない | `http_allowed_cidrs` に現在の IP が入っているか（スマートフォンの回線は別の IP） |
| `--db-init` が接続で固まる／`ETIMEDOUT` | RDS 側の SG が EC2 の SG を参照しているか、サブネットグループの指定。EC2 上で `timeout 5 bash -c '</dev/tcp/<db_host>/3306' && echo ok` |
| `--db-init` が `ENOTFOUND` | VPC の `enable_dns_hostnames` が false |
| `--db-init` が `Access denied` | 1Password の `expense-claim-aws` の `db-password` を apply 後に変えていないか |
| `--up` が health を待ちきれない | `docker compose logs --tail 50 backend`。環境変数の不足は起動時に「環境変数が正しくありません」で落ちる |
| `image not found` / `pull access denied` | `.env` の `TAG` に対応するイメージが未転送。`--images` を先に |
| 502 Bad Gateway | backend コンテナが落ちている。`docker compose ps` |
| リロードで 404 | SPA フォールバック。`nginx/default.conf` の `try_files` |
| IP が変わって `ssh` が警告する | `ssh-keygen -R <IP>` で古い記録を消す |

---

## 片付け（destroy）

**課金を止める最も確実な方法は、リソースを消すことです。**

```bash
# 1. 何が消えるかを先に読む
oprun infra/terraform.op -- terraform -chdir=infra plan -destroy -input=false

# 2. 実行する
oprun --no-masking infra/terraform.op -- terraform -chdir=infra destroy

# 3. state が空になったことを確認する
terraform -chdir=infra state list
```

### 消し忘れの確認

destroy が途中で失敗して一部だけ残ることがあります。全リソースに `Project` タグを付けてあるので、これで横断的に探せます。

```bash
R=ap-northeast-1
aws resourcegroupstaggingapi get-resources --region $R \
  --tag-filters Key=Project,Values=expense-claim --query 'ResourceTagMappingList[].ResourceARN'
aws rds describe-db-instances --region $R --query 'DBInstances[].DBInstanceIdentifier'
aws rds describe-db-snapshots --region $R --snapshot-type manual --query 'DBSnapshots[].DBSnapshotIdentifier'
aws ec2 describe-volumes --region $R --filters Name=status,Values=available --query 'Volumes[].VolumeId'
aws ec2 describe-addresses --region $R --query 'Addresses[].PublicIp'
```

すべて空（`[]`）であれば完了です。`ssh-keygen -R <IP>` で known_hosts の記録も消しておきます。

翌日、実際に課金が止まったかを確認します。

```bash
aws ce get-cost-and-usage --time-period Start=<destroy の前日>,End=<翌々日> \
  --granularity DAILY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE
```

---

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `providers.tf` | プロバイダとバージョンの固定、全リソース共通のタグ |
| `variables.tf` | 入力変数の宣言。SSH と HTTP の全開放、パスワードの記号を機械的に禁止している |
| `network.tf` | VPC・サブネット・ルートテーブル・DB サブネットグループ |
| `security.tf` | セキュリティグループ・キーペア |
| `compute.tf` | AMI の検索と EC2 |
| `database.tf` | RDS（初期データベースは作らせない） |
| `outputs.tf` | 接続情報の出力。`deploy.sh` が読む |
| `terraform.tfvars.example` | 変数の雛形（`db_password` は含まない） |
| `terraform.op` | Terraform に渡す秘密情報の雛形（`db_password`。値は 1Password の参照） |
| `files/user-data.sh` | EC2 の初回起動時に流れる初期化スクリプト（Docker と Compose プラグイン） |
| `files/compose.ec2.yaml` | EC2 で動かす compose ファイル（ビルド定義を持たない） |
| `files/env.ec2.op` | EC2 に配る環境変数の雛形（値は 1Password の参照） |
| `files/db-init.mjs` | 照合順序を指定してデータベースを作るスクリプト |
| `../scripts/deploy.sh` | ローカルでビルドして EC2 へ配置するスクリプト |

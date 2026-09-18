# ---------------------------------------------------------------------------
# 基本
# ---------------------------------------------------------------------------

variable "aws_region" {
  description = "リソースを作成するリージョン"
  type        = string
  default     = "ap-northeast-1"
  # リージョンだけはコードに固定する。認証情報と違い秘密ではなく、
  # 環境変数まかせにすると「意図しないリージョンに作ってしまい、
  # コンソールで探しても見つからない」という事故が起きるため。
}

variable "project" {
  description = "リソース名とタグに使う接頭辞"
  type        = string
  default     = "expense-claim"
}

# ---------------------------------------------------------------------------
# ネットワーク
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "VPC の CIDR ブロック"
  type        = string
  default     = "10.0.0.0/16"
}

# ---------------------------------------------------------------------------
# アクセス制御
# ---------------------------------------------------------------------------

variable "ssh_allowed_cidr" {
  description = "SSH(22) を許可する送信元 CIDR。自分のグローバル IP を /32 で指定する"
  type        = string

  validation {
    # SSH の全開放は事故に直結するため、コード側で機械的に止める。
    # 「気をつける」という人間の注意力に頼らないのが要点。
    condition     = var.ssh_allowed_cidr != "0.0.0.0/0"
    error_message = "SSH を 0.0.0.0/0 に開けることはできません。curl -s https://checkip.amazonaws.com で自分の IP を確認し、/32 を付けて指定してください。"
  }
}

variable "http_allowed_cidrs" {
  description = "HTTP(80) を許可する送信元 CIDR のリスト。自分のグローバル IP を /32 で指定する"
  type        = list(string)
  # 既定値を持たせず、0.0.0.0/0 も拒否する。
  # この環境は GOOGLE_STUB=1 で動かす（infra/README.md）。スタブのログインは
  # Google へ行かず、誰であっても許可アドレス本人として通す。
  # つまり 80 番に届く人は誰でもログインできるので、届く範囲を自分に絞る。
  # スマートフォンから見たいときは、その回線のグローバル IP を足す。

  validation {
    condition     = length(var.http_allowed_cidrs) > 0 && !contains(var.http_allowed_cidrs, "0.0.0.0/0")
    error_message = "http_allowed_cidrs は自分の IP（/32）を 1 つ以上指定してください。0.0.0.0/0 は指定できません（スタブのログインは誰でも通るため）。"
  }
}

variable "ssh_public_key_path" {
  description = "EC2 に登録する公開鍵のパス。秘密鍵はローカルに置いたままにする"
  type        = string
  default     = "~/.ssh/expense-claim-ec2.pub"
}

# ---------------------------------------------------------------------------
# EC2
# ---------------------------------------------------------------------------

variable "instance_type" {
  description = "EC2 のインスタンスタイプ"
  type        = string
  default     = "t3.micro"
  # x86_64 系を選ぶ。ローカル（WSL2 / x86_64）でビルドした Docker イメージを
  # そのまま動かすため、アーキテクチャを揃える必要があるからである。
  # ARM 系の Graviton（t4g）は 2 割ほど安いが、イメージが動かない。
  # メモリ 1GB に node のプロセスが 2 つ（backend と scheduler）載る。
  # 足りなければ t3.small（2GB）に上げる。
}

variable "root_volume_size" {
  description = "EC2 のルートボリュームのサイズ（GB）"
  type        = number
  default     = 16
  # 既定の 8GB だと、Docker イメージを数世代置いた時点で逼迫する。
  # backend イメージは 600MB 弱ある（node_modules に googleapis を含むため）。
}

# ---------------------------------------------------------------------------
# RDS
# ---------------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS のインスタンスクラス"
  type        = string
  default     = "db.t4g.micro"
  # EC2 と違い、RDS は AWS 側が中で動かすマネージドサービスなので、
  # こちらの Docker イメージのアーキテクチャとは無関係である。
  # したがって 2 割ほど安い Graviton（t4g）を選んでよい。
}

variable "db_engine_version" {
  description = "MySQL のバージョン"
  type        = string
  default     = "8.4"
  # メジャーバージョンだけを指定する。マイナーまで固定すると、
  # AWS がそのマイナーを廃止したときに apply が通らなくなるため。
  # ローカル開発は mysql:8.4（compose.override.yaml）なのでメジャーは揃っている。
}

variable "db_name" {
  description = "アプリが使うデータベース名。RDS には作らせず、deploy.sh --db-init が照合順序を指定して作る"
  type        = string
  default     = "expense_claim"
  # aws_db_instance の db_name には渡さない（database.tf のコメント参照）。
  # outputs の database_url と、DB を作る手順だけがこの値を使う。

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{0,63}$", var.db_name))
    error_message = "db_name は小文字英字で始まる英数字と _ の 64 文字以内にしてください。"
  }
}

variable "db_username" {
  description = "RDS のマスターユーザー名"
  type        = string
  default     = "expense"
  # rdsadmin や mysql などの予約語は使えない。
}

variable "db_password" {
  description = "RDS のマスターパスワード。英数字のみにすること"
  type        = string
  sensitive   = true
  # sensitive = true は plan/apply の画面表示で値を伏せるだけの機能で、
  # state には平文で書き込まれる。「付けたから安全」ではない。

  validation {
    # 記号を禁じている理由は 3 つ重なっている。
    #   1. RDS がマスターパスワードに / @ " と空白を許可していない
    #   2. 同じ値が DATABASE_URL（mysql://user:pass@host/db）に埋め込まれる。
    #      記号があると URL エンコードの扱いが要る
    #   3. 同じ値を書いた .env を docker compose が読むが、compose は
    #      引用符の無い値の $ を変数展開として解釈する
    # 英数字だけに制限すれば、3 者すべてで同じ値として扱われる。
    condition     = can(regex("^[A-Za-z0-9]{16,41}$", var.db_password))
    error_message = "db_password は英数字（記号なし）16〜41 文字にしてください。openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24 で生成できます。"
  }
}

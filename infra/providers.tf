# 交通費精算アプリの動作確認環境（EC2 1台 + RDS）。
#
# 前回のスクール課題（task-management）の Terraform を引き継いでいる。
# 設計上の前提は docs/design/01-architecture.md 3.8 / 4章、動かす手順は infra/README.md。
# 動作確認できたら terraform destroy する前提のため、コストを最優先で削っている。

terraform {
  required_version = "~> 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # backend ブロックを書かない＝ローカル state（infra/terraform.tfstate）。
  # S3 バックエンドは複数人・複数端末で共有する場合に効く仕組みで、
  # 単独作業かつ数日で消す今回の構成には過剰なため使わない。
  # state には DB のパスワードが平文で入るので、.env と同格に扱い、コミットしない。
}

provider "aws" {
  region = var.aws_region

  # 認証情報はここに書かない。AWS CLI と同じ解決順（~/.aws/credentials 等）に任せる。

  # ここで指定したタグが、このプロバイダで作る全リソースに自動で付く。
  # リソースごとに tags を書く方式だと必ず付け忘れが出るが、この方式なら漏れない。
  # destroy 後に「消し忘れたリソースが無いか」を探すとき、
  # このタグ1つで全リソースを串刺しに検索できるのが最大の利点である。
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

# アプリケーションサーバー（EC2）。
#
# この 1 台の中で Docker Compose が 3 つのコンテナを動かす（docs/design/01-architecture.md 4.2）。
#   nginx     : 静的ファイル（フロントのビルド成果物をイメージに焼き込んである）と /api/ の振り分け
#   backend   : Hono の API サーバー
#   scheduler : 提出アラート。backend と同じイメージを別コマンドで起動する
# ホストに入れるのは Docker と Compose プラグインだけで、nginx も Node.js も入れない。

# 最新の Amazon Linux 2023 の AMI ID を取得する。
# AMI ID はリージョンごとに異なるうえ、AWS が更新するたびに変わるため、
# コードに直接書かず、その都度問い合わせる。
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name = "name"
    # "al2023-ami-2023.*-x86_64" は標準版にマッチする。
    # minimal 版は "al2023-ami-minimal-*" という別の名前なので、この条件では拾わない。
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.al2023.id
  instance_type = var.instance_type

  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  key_name               = aws_key_pair.deployer.key_name

  user_data = file("${path.module}/files/user-data.sh")

  # user_data は既定では「変更してもインスタンスを作り直さず、再実行もしない」。
  # つまりスクリプトを直しても黙って無視される、という最も分かりにくい挙動になる。
  # true にすると、変更が plan に -/+（作り直し）として必ず現れるようになる。
  user_data_replace_on_change = true

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
    encrypted   = true

    # 既定で true だが明示する。false だとインスタンスを消しても
    # ボリュームだけが残り、課金され続ける（消し忘れの代表例）。
    delete_on_termination = true
  }

  metadata_options {
    # IMDSv2 を必須にする。インスタンスメタデータ（IAM 認証情報などを含む）の
    # 取得にトークンを要求する方式で、SSRF 経由での窃取を防ぐ。
    http_tokens = "required"

    # ホップ数 1 は「コンテナの中からはメタデータに到達できない」ことを意味する。
    # 今回コンテナは AWS の API を叩かないため、絞っておいて差し支えない。
    http_put_response_hop_limit = 1
  }

  credit_specification {
    # T 系インスタンスは既定で unlimited モードになっており、
    # CPU クレジットを使い切った後も性能を維持する代わりに追加課金が発生する。
    # standard にすると追加課金は起きず、単に遅くなるだけになる。
    cpu_credits = "standard"
  }

  lifecycle {
    # data.aws_ami が「最新」を引く仕組みのため、AWS が新しい AMI を公開するたびに
    # 差分が出て「インスタンスを作り直す」plan になってしまう。
    # 一度立てたら作り直したくないので、AMI の変更は無視する。
    ignore_changes = [ami]
  }

  tags = { Name = "${var.project}-app" }
}

# Elastic IP は意図的に作っていない。
# パブリック IP はサブネットの map_public_ip_on_launch により自動で割り当たる。
# EIP は「どこにも紐づいていない状態でも課金される」代表的な消し忘れリソースであり、
# 停止・起動を行わない今回の運用では IP が変わることもないため、必要がない。

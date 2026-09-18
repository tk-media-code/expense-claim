# セキュリティグループとキーペア。
#
# セキュリティグループは EC2 インスタンスの外側（ENI＝仮想 NIC）で評価される、
# ステートフルなファイアウォールである。「ステートフル」とは、
# 許可した通信の戻りパケットが自動で通ることを意味する。
# したがって「HTTP を受ける」ために egress 側で何かを許可する必要はない。
#
# ルールを SG リソースのインライン（ingress ブロック）ではなく独立したリソースで
# 書いているのは、plan の読みやすさのためである。自宅の IP が変わって
# ssh_allowed_cidr を書き換えたとき、インライン形式だと「SG 全体の書き換え」に
# 見えて怖いが、この形式なら「ルール 1 本の置き換え」として出る。
#
# EC2 上ではコンテナの 80 番を Docker がホストの 80 番に公開する。Docker は iptables を
# 直接書き換えて公開するため、OS 側のファイアウォールは通らない。
# 外から届く範囲を決めるのはこの SG だけである。

# ---------------------------------------------------------------------------
# EC2 用
# ---------------------------------------------------------------------------

resource "aws_security_group" "ec2" {
  name        = "${var.project}-ec2"
  description = "EC2: HTTP and SSH from my IP"
  vpc_id      = aws_vpc.main.id

  # ingress/egress ブロックはここに書かない。
  # 独立したルールリソースと併用すると、互いの変更を打ち消し合う。

  tags = { Name = "${var.project}-ec2-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "ec2_http" {
  for_each = toset(var.http_allowed_cidrs)

  security_group_id = aws_security_group.ec2.id
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP from my IP only"
}

resource "aws_vpc_security_group_ingress_rule" "ec2_ssh" {
  security_group_id = aws_security_group.ec2.id
  cidr_ipv4         = var.ssh_allowed_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  description       = "SSH from my IP only"
}

resource "aws_vpc_security_group_egress_rule" "ec2_all" {
  security_group_id = aws_security_group.ec2.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1" # 全プロトコル。-1 のときは from_port/to_port を書かない

  # description には日本語（マルチバイト文字）を書けない。
  # AWS が許可するのは a-zA-Z0-9 と一部の記号だけで、
  # 違反すると apply 時に InvalidParameterValue で弾かれる。
  # ここでの egress の用途は「dnf と Compose プラグインの取得」と「RDS への接続」である。
  description = "outbound for dnf, GitHub and RDS"
}

# アプリのポート 3000 に対する ingress ルールは、意図的に作っていない。
# backend コンテナは compose のネットワーク内で nginx からだけ呼ばれ、
# ホストにポートを公開していない（infra/files/compose.ec2.yaml）。
# 外に開いているのは nginx の 80 番だけである。

# ---------------------------------------------------------------------------
# RDS 用
# ---------------------------------------------------------------------------

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "RDS: MySQL from EC2 security group only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-rds-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ec2" {
  security_group_id = aws_security_group.rds.id

  # 送信元に CIDR ではなくセキュリティグループを指定している。
  # これが AWS らしい書き方で、利点が 2 つある。
  #   1. EC2 のプライベート IP が変わっても追随しなくてよい
  #   2. 「この SG が付いたインスタンスだけ」という意図がコードに現れる
  referenced_security_group_id = aws_security_group.ec2.id

  ip_protocol = "tcp"
  from_port   = 3306
  to_port     = 3306
  description = "MySQL from EC2"
}

# RDS 側に egress ルールは作らない。
# RDS は接続を受けるだけで自分から外に出ることがないため、
# 「無い」のが正しい状態である。これは NAT Gateway を作らずに済む理由でもある。

# ---------------------------------------------------------------------------
# キーペア
# ---------------------------------------------------------------------------

resource "aws_key_pair" "deployer" {
  key_name = "${var.project}-deployer"

  # pathexpand() が必要である。Terraform の file() は "~" を
  # ホームディレクトリに展開しないため、そのまま渡すとエラーになる。
  public_key = file(pathexpand(var.ssh_public_key_path))

  # AWS に渡すのは公開鍵だけで、秘密鍵はローカルに置いたままにする。
  # tls_private_key リソースで Terraform に鍵を生成させる方法もあるが、
  # その場合「秘密鍵が state に平文で保存される」ため使わない。

  tags = { Name = "${var.project}-deployer" }
}

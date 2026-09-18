# ネットワーク層。
#
# 構成の要点は「NAT Gateway を作らない」こと。NAT Gateway は月 45 ドル程度かかり、
# この構成で最大の課金要因になりうるが、今回は不要である（理由は下の
# aws_route_table.private のコメント参照）。

# 使用可能な AZ を問い合わせる。
# AZ を "ap-northeast-1a" のように決め打ちすると、その AZ で目的の
# インスタンスタイプが提供されていない場合に apply が失敗する。
# 実際、東京リージョンの 1b では t3.micro が使えない。
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  # この 2 つは既定で false だが、両方とも有効にしないと
  # RDS のエンドポイント名（xxx.ap-northeast-1.rds.amazonaws.com）を
  # インスタンス内から名前解決できない。
  # 「SG もサブネットも正しいのに DB に繋がらない」ときの典型的な原因である。
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project}-vpc" }
}

# インターネットゲートウェイ。VPC とインターネットの出入口。
# これ自体は無料で、通信量に対しても課金されない。
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.project}-igw" }
}

# ---------------------------------------------------------------------------
# パブリックサブネット（EC2 を置く）
# ---------------------------------------------------------------------------

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 0) # 10.0.0.0/24
  availability_zone = data.aws_availability_zones.available.names[0]

  # ここに置いたインスタンスに自動でパブリック IP を割り当てる。
  # Elastic IP を別途作る方法もあるが、EIP は「どこにも紐づいていない状態でも
  # 課金される」代表的な消し忘れリソースなので、今回は使わない。
  # 代償は「インスタンスを停止・起動すると IP が変わる」ことだけである。
  map_public_ip_on_launch = true

  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  # 0.0.0.0/0（VPC 内で解決できない宛先すべて）を IGW に向ける。
  # 「パブリックサブネット」と「プライベートサブネット」の違いは、
  # 突き詰めるとこの 1 行があるかどうかでしかない。
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# プライベートサブネット（RDS を置く）
# ---------------------------------------------------------------------------

# RDS のサブネットグループは「2 つ以上の AZ にまたがること」を必須要件としている。
# 今回は Single-AZ 構成で RDS 本体は片方にしか置かないが、
# 要件を満たすためだけにもう 1 つ作る。片方は空のままで構わない。
resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10) # 10.0.10.0/24, 10.0.11.0/24
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "${var.project}-private-${count.index}" }
}

# プライベートサブネット用のルートテーブル。
#
# 0.0.0.0/0 のルートを「書かない」ことが重要である。
# 書かなければ、このサブネット内のリソースは外部と通信できない。
#
# 外部に出たいなら通常は NAT Gateway（月 45 ドル程度）が要るが、
# RDS は「EC2 からの接続を受ける」だけで自分から外に出ることがないため、
# NAT Gateway は不要である。ここが今回の構成で最大のコスト削減になっている。
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.project}-private-rt" }
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# RDS に「どのサブネットに置くか」を伝えるためのグループ。
resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${var.project}-db-subnet-group" }
}

# データベース（RDS for MySQL）。
#
# バックアップやスナップショットを一切残さない設定にしている。
# これは本番運用では絶対にやってはいけない設定だが、今回は
#   ・動作確認用の一時環境で、データは残す必要が無い
#   ・destroy 後に課金が残る要因を 1 つも作らない
# という 2 点を優先した意図的な判断である。
resource "aws_db_instance" "app" {
  identifier = "${var.project}-db"

  engine         = "mysql"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class
  port           = 3306

  username = var.db_username
  password = var.db_password

  # db_name は意図的に指定しない。
  # RDS に初期データベースを作らせると、照合順序がサーバー既定の utf8mb4_0900_ai_ci になる。
  # このアプリは utf8mb4_ja_0900_as_cs を前提にしている（docs/design/03-database.md 4.1。
  # 既定の ai_ci だと濁点の有無を区別せず、駅名の UNIQUE 制約が壊れる）。
  # マイグレーション SQL は照合順序を持たず、テーブルはデータベースの既定を継承するので、
  # データベースそのものを正しい照合順序で作る必要がある。
  # そこで scripts/deploy.sh --db-init が CREATE DATABASE ... COLLATE を明示して作る。
  # パラメータグループで collation_server を変える案は、RDS が初期データベースを作る
  # タイミングでそれが効く保証が無く、リソースも増えるので採らなかった。

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true # 追加費用はかからない

  # ストレージの自動拡張を無効化する。
  # 有効にしていると、気づかないうちに容量が増えて課金額も増える。
  max_allocated_storage = 0

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # インターネットから直接接続できないようにする。
  # ただしこれはセキュリティグループの代わりではなく、
  # 「パブリック IP を持たせるかどうか」の設定である。両方が必要。
  publicly_accessible = false

  # 待機系を別 AZ に持つ構成。可用性は上がるが料金がほぼ倍になる。
  multi_az = false

  # EC2 と同じ AZ に置く。
  # 別 AZ になると、EC2 と RDS の間の通信が AZ 間データ転送の課金対象になる
  # （往復で $0.01/GB × 2）。同一 AZ なら無料である。
  availability_zone = aws_subnet.private[0].availability_zone

  # --- ここから下はコスト最小化と destroy の確実性のための設定 ---

  # 自動バックアップを無効化する（0 日保持）。
  # 有効だとスナップショットの保管料が発生し、destroy 後も残ることがある。
  backup_retention_period  = 0
  delete_automated_backups = true

  # destroy 時に「最終スナップショット」を作らせない。
  # 作ると、DB を消したのにスナップショットの課金だけが延々と残る。
  # 消し忘れ課金の最大の要因がこれである。
  skip_final_snapshot = true

  # true だと terraform destroy がエラーで失敗する。
  # 数日で消す前提なので明示的に false にしておく。
  deletion_protection = false

  # 監視系はいずれも課金対象になりうるので無効にする
  performance_insights_enabled = false
  monitoring_interval          = 0

  # 変更をメンテナンスウィンドウまで待たずに即座に適用する
  apply_immediately = true

  tags = { Name = "${var.project}-db" }
}

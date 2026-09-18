# 出力値。
#
# scripts/deploy.sh がこれらを terraform output -raw で読み取ることで、
# IP アドレスやパスワードを人間が手で打ち写す工程をなくしている。
# 接続できないときの原因は、たいてい単純な打ち間違いだからである。

output "app_url" {
  description = "アプリケーションの URL"
  value       = "http://${aws_instance.app.public_ip}/"
}

output "ec2_public_ip" {
  description = "EC2 のパブリック IP"
  value       = aws_instance.app.public_ip
}

output "ssh_command" {
  description = "EC2 に接続するコマンド"
  value       = "ssh -i ${trimsuffix(var.ssh_public_key_path, ".pub")} ec2-user@${aws_instance.app.public_ip}"
}

output "db_host" {
  description = "RDS のホスト名（ポートを含まない）"
  value       = aws_db_instance.app.address
}

output "db_endpoint" {
  description = "RDS のエンドポイント（ホスト名:ポート）"
  value       = aws_db_instance.app.endpoint
}

output "db_username" {
  description = "DB のユーザー名"
  value       = aws_db_instance.app.username
}

output "db_name" {
  description = "アプリが使うデータベース名（deploy.sh --db-init が作る）"
  # aws_db_instance に db_name を渡していないので、リソース側の属性は空になる。
  # 変数の値をそのまま出す。
  value = var.db_name
}

output "db_password" {
  description = "DB のパスワード（terraform output -raw db_password で取得）"
  value       = var.db_password
  sensitive   = true
  # この値はもともと state に平文で保存されているため、
  # output にしたことで新たに漏れる経路が増えるわけではない。
  # むしろ手で打ち写す経路をなくせる分、事故が減る。
}

output "database_url" {
  description = "backend に渡す DATABASE_URL（terraform output -raw database_url で取得）"
  # endpoint は "ホスト名:ポート" の形式で返るため、そのまま URL に組み込める。
  # db_password は英数字に限定している（variables.tf）ので URL エンコードは要らない。
  value     = "mysql://${aws_db_instance.app.username}:${var.db_password}@${aws_db_instance.app.endpoint}/${var.db_name}"
  sensitive = true
}

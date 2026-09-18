// アプリ用のデータベースを、照合順序を指定して作る。scripts/deploy.sh --db-init が実行する。
//
// RDS に初期データベースを作らせない理由は infra/database.tf のコメントにある。
// このアプリは utf8mb4_ja_0900_as_cs を前提にしており（docs/design/03-database.md 4.1）、
// マイグレーション SQL は照合順序を持たずデータベースの既定を継承する。
// したがって CREATE DATABASE の時点で照合順序を決めておく必要がある。
//
// EC2 上で backend イメージの中の mysql2（アプリと同じドライバ）を使って実行する。
// MySQL クライアントを別途入れないのは、mysql:8.4 イメージが 800MB あり、
// メモリ 1GB・ディスク 16GB の EC2 に一時的な CREATE DATABASE のためだけに置きたくないから。
//
//   ssh ec2 'cd ~/expense-claim && docker compose run --rm -T --no-deps backend \
//     node --input-type=module -' < infra/files/db-init.mjs
//
// 冪等である（IF NOT EXISTS）。作ったあと、データベースと全テーブルの照合順序を読み返し、
// 1 つでも違えば終了コード 1 で落とす。先に別の照合順序で作られていた場合を黙って通さない。

import mysql from 'mysql2/promise';

const CHARSET = 'utf8mb4';
const COLLATION = 'utf8mb4_ja_0900_as_cs';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error('DATABASE_URL が空です。deploy.sh --env で .env を配置してください。');
	process.exit(1);
}

const url = new URL(databaseUrl);
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
// バッククォートで囲んで CREATE DATABASE に埋め込むので、名前の形を先に縛る
if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(database)) {
	console.error(`DATABASE_URL のデータベース名が不正です: "${database}"`);
	process.exit(1);
}

// データベースはまだ無いので、database を指定せずに繋ぐ
const connection = await mysql.createConnection({
	host: url.hostname,
	port: Number(url.port || 3306),
	user: decodeURIComponent(url.username),
	password: decodeURIComponent(url.password),
});

try {
	await connection.query(
		`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET ${CHARSET} COLLATE ${COLLATION}`,
	);

	const [schemata] = await connection.query(
		`SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation
		 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
		[database],
	);
	const [tables] = await connection.query(
		`SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation
		 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
		 ORDER BY TABLE_NAME`,
		[database],
	);

	const schema = schemata[0];
	console.log(`database ${database}: ${schema.charset} / ${schema.collation}`);
	for (const table of tables) {
		console.log(`  ${table.name}: ${table.collation}`);
	}

	const wrong = [
		...(schema.collation === COLLATION ? [] : [database]),
		...tables.filter((table) => table.collation !== COLLATION).map((table) => table.name),
	];
	if (wrong.length > 0) {
		console.error(`照合順序が ${COLLATION} ではありません: ${wrong.join(', ')}`);
		process.exit(1);
	}
	console.log(`ok: ${COLLATION}（テーブル ${tables.length} 件）`);
} finally {
	await connection.end();
}

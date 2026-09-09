import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';

import {
	COLLATION,
	MYSQL_HOST,
	MYSQL_PORT,
	MYSQL_ROOT_PASSWORD,
	MYSQL_USER,
	TEST_DB_NAME,
	TEST_DATABASE_URL,
} from './database.js';

// docker-entrypoint-initdb.d は使わない。
// あれはデータディレクトリが空のときにしか走らないので、既に mysql_data が育っている
// 環境では黙って何も起きない。ここで冪等に用意する（07-development.md 4章）。
export default async function setup(): Promise<void> {
	let admin: mysql.Connection;
	try {
		admin = await mysql.createConnection({
			host: MYSQL_HOST,
			port: MYSQL_PORT,
			user: 'root',
			password: MYSQL_ROOT_PASSWORD,
		});
	} catch (cause) {
		throw new Error(
			`MySQL に繋がりません（${MYSQL_HOST}:${MYSQL_PORT}）。\n` +
				'  docker compose up -d mysql --wait を実行してから、もう一度走らせてください。',
			{ cause },
		);
	}

	try {
		await admin.query(
			`CREATE DATABASE IF NOT EXISTS \`${TEST_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE ${COLLATION}`,
		);
		await admin.query(`GRANT ALL ON \`${TEST_DB_NAME}\`.* TO '${MYSQL_USER}'@'%'`);
		await admin.query('FLUSH PRIVILEGES');
	} finally {
		await admin.end();
	}

	const pool = mysql.createPool({
		uri: TEST_DATABASE_URL,
		timezone: 'Z',
		multipleStatements: true,
	});
	try {
		await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
	} finally {
		await pool.end();
	}
}

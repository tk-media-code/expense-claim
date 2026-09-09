import { defineConfig } from 'drizzle-kit';

// 生成した SQL は backend/drizzle/ にコミットする（03-database.md 10.2）。
// 何が流れるか読めない変更を本番へ持っていかないため、生成物をレビューの対象にする。
export default defineConfig({
	dialect: 'mysql',
	schema: './src/db/schema.ts',
	out: './drizzle',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'mysql://expense:expense@127.0.0.1:3306/expense_claim',
	},
});

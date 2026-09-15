import { desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { submissions } from '../db/schema.js';
import { firstDayOf, type ProjectMonth, type TargetMonth } from '../domain/month.js';

/** 月度ごとの最新の提出（F-30） */
export type LatestSubmission = { targetMonth: TargetMonth; executedAt: Date; writtenRows: number };

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
export function createSubmissionsRepository(db: Database) {
	return {
		// 提出の実行を1行残す（F-30）。1文なのでトランザクションを開かない（06-error-handling.md 6.3）
		async add(targetMonth: TargetMonth, executedAt: Date, writtenRows: number): Promise<void> {
			await db
				.insert(submissions)
				.values({ targetMonth: firstDayOf(targetMonth), executedAt, writtenRows });
		},

		// 「提出済みか」は行の有無、「いつ」は最新の executed_at（03-database.md 5.2）
		async findLatest(targetMonth: TargetMonth): Promise<LatestSubmission | null> {
			const rows = await db
				.select({ executedAt: submissions.executedAt, writtenRows: submissions.writtenRows })
				.from(submissions)
				.where(eq(submissions.targetMonth, firstDayOf(targetMonth)))
				.orderBy(desc(submissions.executedAt), desc(submissions.id))
				.limit(1);
			const row = rows[0];
			return row ? { targetMonth, ...row } : null;
		},

		// ホームの月度の状態（11-7）と月度切替の削除（11-8）。提出済みの月度 → 最新の実行日時。
		// 案件の月度（ProjectMonth）で「その月度は提出済みか」を引くので、両方の型を受ける。
		// 鍵は YYYY-MM の素の文字列で、呼び出し側が自分の型の値で引く
		async submittedMonths(months: (TargetMonth | ProjectMonth)[]): Promise<Map<string, Date>> {
			const result = new Map<string, Date>();
			if (months.length === 0) return result;
			const rows = await db
				.select({ targetMonth: submissions.targetMonth, executedAt: submissions.executedAt })
				.from(submissions)
				.where(inArray(submissions.targetMonth, months.map(firstDayOf)))
				.orderBy(desc(submissions.executedAt));
			for (const row of rows) {
				const month = row.targetMonth.slice(0, 7);
				if (!result.has(month)) result.set(month, row.executedAt);
			}
			return result;
		},
	};
}

export type SubmissionsRepository = ReturnType<typeof createSubmissionsRepository>;

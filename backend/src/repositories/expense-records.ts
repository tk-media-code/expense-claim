import { asc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { expenseRecordLegs, expenseRecords } from '../db/schema.js';
import type { ExpenseRecord, ExpenseRecordLeg, TripType } from '../domain/expense-record.js';

/** 保存に要るもの。legs は services が domain の buildLegs で組み立てて渡す */
export type ExpenseRecordInput = {
	tripType: TripType;
	outboundRouteId: number;
	returnRouteId: number;
	legs: ExpenseRecordLeg[];
};

/** ホームと詳細が「記録の済み／未」と合計を出すための要約（F-21） */
export type ExpenseRecordSummary = { projectId: number; tripType: TripType; total: number };

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 呼び出し側が受け取るのは domain の型だけである。
export function createExpenseRecordsRepository(db: Database) {
	async function legsOf(recordId: number): Promise<ExpenseRecordLeg[]> {
		return db
			.select({
				sortOrder: expenseRecordLegs.sortOrder,
				fromStationName: expenseRecordLegs.fromStationName,
				toStationName: expenseRecordLegs.toStationName,
				amount: expenseRecordLegs.amount,
			})
			.from(expenseRecordLegs)
			.where(eq(expenseRecordLegs.expenseRecordId, recordId))
			.orderBy(asc(expenseRecordLegs.sortOrder));
	}

	async function findByProjectId(projectId: number): Promise<ExpenseRecord | null> {
		const rows = await db
			.select({
				id: expenseRecords.id,
				tripType: expenseRecords.tripType,
				outboundRouteId: expenseRecords.outboundRouteId,
				returnRouteId: expenseRecords.returnRouteId,
				recordedAt: expenseRecords.recordedAt,
			})
			.from(expenseRecords)
			.where(eq(expenseRecords.projectId, projectId))
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return { ...row, legs: await legsOf(row.id) };
	}

	return {
		findByProjectId,

		// 作るのも直すのも同じ入口（04-api.md 4.5 の PUT）。1案件に記録は 0 か 1 なので、
		// あれば id を保ったまま上書きし、無ければ作る。記録と区間の行は1組で書く（06-error-handling.md 6.1。
		// 外部呼び出しをまたがず DB の中で完結する不変条件なので、トランザクションで囲む）
		async save(projectId: number, input: ExpenseRecordInput): Promise<ExpenseRecord> {
			const now = new Date();
			const id = await db.transaction(async (tx) => {
				const existing = await tx
					.select({ id: expenseRecords.id })
					.from(expenseRecords)
					.where(eq(expenseRecords.projectId, projectId))
					.limit(1);
				const values = {
					tripType: input.tripType,
					outboundRouteId: input.outboundRouteId,
					returnRouteId: input.returnRouteId,
					recordedAt: now,
					updatedAt: now,
				};
				let recordId: number;
				if (existing[0]) {
					recordId = existing[0].id;
					await tx.update(expenseRecords).set(values).where(eq(expenseRecords.id, recordId));
					await tx.delete(expenseRecordLegs).where(eq(expenseRecordLegs.expenseRecordId, recordId));
				} else {
					const [row] = await tx
						.insert(expenseRecords)
						.values({ projectId, ...values, createdAt: now })
						.$returningId();
					if (!row) throw new Error('expense_records の insert が id を返さなかった');
					recordId = row.id;
				}
				await tx
					.insert(expenseRecordLegs)
					.values(input.legs.map((leg) => ({ expenseRecordId: recordId, ...leg })));
				return recordId;
			});
			const saved = await findByProjectId(projectId);
			if (saved === null) throw new Error(`保存したばかりの記録 ${id} を読み直せなかった`);
			return saved;
		},

		// ホームの案件カードが「記録済み」と合計を出すために、案件をまとめて引く（4-5）。
		// 案件ごとに findByProjectId を呼ぶと月6〜10件ぶん往復するので、1クエリで足す
		async summarize(projectIds: number[]): Promise<Map<number, ExpenseRecordSummary>> {
			const result = new Map<number, ExpenseRecordSummary>();
			if (projectIds.length === 0) return result;
			const rows = await db
				.select({
					projectId: expenseRecords.projectId,
					tripType: expenseRecords.tripType,
					amount: expenseRecordLegs.amount,
				})
				.from(expenseRecords)
				.innerJoin(expenseRecordLegs, eq(expenseRecordLegs.expenseRecordId, expenseRecords.id))
				.where(inArray(expenseRecords.projectId, projectIds));
			for (const row of rows) {
				const current = result.get(row.projectId) ?? {
					projectId: row.projectId,
					tripType: row.tripType,
					total: 0,
				};
				current.total += row.amount;
				result.set(row.projectId, current);
			}
			return result;
		},
	};
}

export type ExpenseRecordsRepository = ReturnType<typeof createExpenseRecordsRepository>;

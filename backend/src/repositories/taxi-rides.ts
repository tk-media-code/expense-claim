import { asc, count, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { receipts, taxiRides } from '../db/schema.js';
import { parseCalendarDate, type CalendarDate } from '../domain/month.js';
import type { TaxiRide } from '../domain/taxi-ride.js';

export type TaxiRideInput = { rodeOn: CalendarDate; amount: number };
export type ReceiptInput = {
	driveFileId: string;
	driveUrl: string;
	fileName: string;
	mimeType: string;
};

/** 提出行の I列と M列のための、案件ごとの乗車（11-2） */
export type TaxiRideForSubmission = {
	projectId: number;
	rodeOn: CalendarDate;
	amount: number;
	driveUrl: string;
};

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
export function createTaxiRidesRepository(db: Database) {
	const columns = {
		id: taxiRides.id,
		projectId: taxiRides.projectId,
		rodeOn: taxiRides.rodeOn,
		amount: taxiRides.amount,
		fileName: receipts.fileName,
		driveUrl: receipts.driveUrl,
	};

	function toTaxiRide(row: {
		id: number;
		rodeOn: string;
		amount: number;
		fileName: string;
		driveUrl: string;
	}): TaxiRide {
		const rodeOn = parseCalendarDate(row.rodeOn);
		if (!rodeOn) throw new Error(`taxi_rides.rode_on が暦日でない: ${row.rodeOn}`);
		return {
			id: row.id,
			rodeOn,
			amount: row.amount,
			receipt: { fileName: row.fileName, driveUrl: row.driveUrl },
		};
	}

	return {
		// 領収書つきで、乗った順（id 順）。領収書は乗車1対1なので INNER JOIN で欠けない
		async listByProjectId(projectId: number): Promise<TaxiRide[]> {
			const rows = await db
				.select(columns)
				.from(taxiRides)
				.innerJoin(receipts, eq(receipts.taxiRideId, taxiRides.id))
				.where(eq(taxiRides.projectId, projectId))
				.orderBy(asc(taxiRides.id));
			return rows.map(toTaxiRide);
		},

		async findById(id: number): Promise<(TaxiRide & { projectId: number }) | null> {
			const rows = await db
				.select(columns)
				.from(taxiRides)
				.innerJoin(receipts, eq(receipts.taxiRideId, taxiRides.id))
				.where(eq(taxiRides.id, id))
				.limit(1);
			const row = rows[0];
			return row ? { ...toTaxiRide(row), projectId: row.projectId } : null;
		},

		// ファイル名の連番に使う（03-database.md 5.2）
		async countByProjectId(projectId: number): Promise<number> {
			const rows = await db
				.select({ count: count() })
				.from(taxiRides)
				.where(eq(taxiRides.projectId, projectId));
			return rows[0]?.count ?? 0;
		},

		// 乗車と領収書を1組で書く。ここだけをトランザクションで囲む（06-error-handling.md 6.2 の④）。
		// 領収書の無い乗車を作らない（F-26）
		async create(
			projectId: number,
			ride: TaxiRideInput,
			receipt: ReceiptInput,
			at: Date,
		): Promise<TaxiRide> {
			const id = await db.transaction(async (tx) => {
				const [row] = await tx
					.insert(taxiRides)
					.values({ projectId, rodeOn: ride.rodeOn, amount: ride.amount, createdAt: at })
					.$returningId();
				if (!row) throw new Error('taxi_rides の insert が id を返さなかった');
				await tx.insert(receipts).values({ taxiRideId: row.id, ...receipt, storedAt: at });
				return row.id;
			});
			return {
				id,
				rodeOn: ride.rodeOn,
				amount: ride.amount,
				receipt: { fileName: receipt.fileName, driveUrl: receipt.driveUrl },
			};
		},

		// 領収書の行は CASCADE で落ちる。ドライブの実体は消さない（要件定義 6.4）
		async remove(id: number): Promise<void> {
			await db.delete(taxiRides).where(eq(taxiRides.id, id));
		},

		// ホームと詳細の taxiCount。案件ごとにまとめて数える
		async countByProjectIds(projectIds: number[]): Promise<Map<number, number>> {
			const result = new Map<number, number>();
			if (projectIds.length === 0) return result;
			const rows = await db
				.select({ projectId: taxiRides.projectId, count: count() })
				.from(taxiRides)
				.where(inArray(taxiRides.projectId, projectIds))
				.groupBy(taxiRides.projectId);
			for (const row of rows) result.set(row.projectId, row.count);
			return result;
		},

		// 提出（11-2）。I列は案件ごとの合算、M列は乗車ごとの URL
		async listForSubmission(projectIds: number[]): Promise<TaxiRideForSubmission[]> {
			if (projectIds.length === 0) return [];
			const rows = await db
				.select({
					projectId: taxiRides.projectId,
					rodeOn: taxiRides.rodeOn,
					amount: taxiRides.amount,
					driveUrl: receipts.driveUrl,
				})
				.from(taxiRides)
				.innerJoin(receipts, eq(receipts.taxiRideId, taxiRides.id))
				.where(inArray(taxiRides.projectId, projectIds))
				.orderBy(asc(taxiRides.rodeOn), asc(taxiRides.id));
			return rows.map((row) => {
				const rodeOn = parseCalendarDate(row.rodeOn);
				if (!rodeOn) throw new Error(`taxi_rides.rode_on が暦日でない: ${row.rodeOn}`);
				return { projectId: row.projectId, rodeOn, amount: row.amount, driveUrl: row.driveUrl };
			});
		},
	};
}

export type TaxiRidesRepository = ReturnType<typeof createTaxiRidesRepository>;

import { count, eq, or } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { segments, stations } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import type { Station } from '../domain/station.js';
import { isDuplicateEntry, isRowReferenced } from './mysql-error.js';

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 呼び出し側が受け取るのは domain の型だけである。
export function createStationsRepository(db: Database) {
	// segmentCount は出発駅か到着駅がこの駅である区間の数。CHECK (from <> to) があるので、
	// OR で結合しても1本の区間を2回数えることはない。
	//
	// 一覧と1件で同じ結合を2度書かない。Drizzle は where を groupBy より先に呼ばせるので、
	// 共通にできるのは leftJoin までである。
	function withSegmentCount() {
		return db
			.select({ id: stations.id, name: stations.name, segmentCount: count(segments.id) })
			.from(stations)
			.leftJoin(
				segments,
				or(eq(segments.fromStationId, stations.id), eq(segments.toStationId, stations.id)),
			);
	}

	// GROUP BY に name も入れるのは、ONLY_FULL_GROUP_BY の関数従属（PK だけで済む）に
	// 寄りかからないため（01-architecture.md 6.1 の縛り4）。
	const groupByStation = [stations.id, stations.name] as const;

	return {
		// 名前順。配列の順序がそのまま画面の順序である（04-api.md 5.1 の流儀）。
		// 照合順序 utf8mb4_ja_0900_as_cs の並びになる。
		async list(): Promise<Station[]> {
			return withSegmentCount()
				.groupBy(...groupByStation)
				.orderBy(stations.name);
		},

		// 1-4 の PUT / DELETE が、無い駅を 404 に、使用中を 409 に分けるために読む。
		// 使われているかどうかは segmentCount で分かるので、専用の数え方を持たない。
		async findById(id: number): Promise<Station | null> {
			const rows = await withSegmentCount()
				.where(eq(stations.id, id))
				.groupBy(...groupByStation);
			return rows[0] ?? null;
		},

		// 重複の先読み用（03-database.md 10.2。UNIQUE をアプリ側検証の代わりにしない）。
		// id を返すのは、1-4 の PUT が「判定から自分自身を除く」ため（04-api.md 4.7）。
		async findIdByName(name: string): Promise<number | null> {
			const rows = await db
				.select({ id: stations.id })
				.from(stations)
				.where(eq(stations.name, name))
				.limit(1);
			return rows[0]?.id ?? null;
		},

		async create(name: string): Promise<Station> {
			// DB 既定値が無いのでアプリが入れる。UTC（03-database.md 4.2）
			const now = new Date();
			try {
				const [row] = await db
					.insert(stations)
					.values({ name, createdAt: now, updatedAt: now })
					.$returningId();
				if (!row) throw new Error('stations の insert が id を返さなかった');
				return { id: row.id, name, segmentCount: 0 };
			} catch (cause) {
				// 二重の網。services の先読みをすり抜けた重複を、同じ 409 に写す。
				// stations の UNIQUE は name の1本だけなので、制約名までは見ない。
				if (isDuplicateEntry(cause)) throw new AppError('STATION_NAME_DUPLICATED', { cause });
				throw cause;
			}
		},

		// 直せるのは名前だけである（決定22）。使われていても通す（04-api.md 4.7）。
		async update(id: number, name: string): Promise<void> {
			try {
				await db.update(stations).set({ name, updatedAt: new Date() }).where(eq(stations.id, id));
			} catch (cause) {
				// create と同じ二重の網。services の先読みをすり抜けた重複を、同じ 409 に写す
				if (isDuplicateEntry(cause)) throw new AppError('STATION_NAME_DUPLICATED', { cause });
				throw cause;
			}
		},

		// delete は予約語で repository.delete(…) が読みにくいので remove にする。
		async remove(id: number): Promise<void> {
			try {
				await db.delete(stations).where(eq(stations.id, id));
			} catch (cause) {
				// 二重の網。services の先読みをすり抜けた「使用中」を、同じ 409 に写す。
				// stations を参照する外部キーは segments の2本だけなので、制約名までは見ない
				if (isRowReferenced(cause)) throw new AppError('STATION_IN_USE', { cause });
				throw cause;
			}
		},
	};
}

export type StationsRepository = ReturnType<typeof createStationsRepository>;

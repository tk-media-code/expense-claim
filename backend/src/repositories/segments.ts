import { and, countDistinct, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import type { Database } from '../db/client.js';
import { routeSegments, segments, stations } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import type { Segment } from '../domain/segment.js';
import { isDuplicateEntry, isNoReferencedRow, isRowReferenced } from './mysql-error.js';

/** 登録に要る列。id と routeCount はサーバーが決める */
export type SegmentInput = { fromStationId: number; toStationId: number; oneWayFare: number };

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 呼び出し側が受け取るのは domain の型だけである。
export function createSegmentsRepository(db: Database) {
	// 出発駅と到着駅で stations を2回引く。同じテーブルなので別名が要る
	const fromStation = alias(stations, 'from_station');
	const toStation = alias(stations, 'to_station');

	const columns = {
		id: segments.id,
		fromStationId: segments.fromStationId,
		fromStationName: fromStation.name,
		toStationId: segments.toStationId,
		toStationName: toStation.name,
		oneWayFare: segments.oneWayFare,
	};

	// routeCount はこの区間を使っているルートの数。route_segments に UNIQUE (route_id, segment_id) が
	// 無く（03-database.md 5.1）、同じ区間を1本のルートが2回使えるので、行数ではなく route_id を
	// DISTINCT で数える。
	//
	// 一覧と1件で同じ結合を2度書かない。Drizzle は where を groupBy より先に呼ばせるので、
	// 共通にできるのは leftJoin までである（stations と同じ）。
	function withRouteCount() {
		return db
			.select({ ...columns, routeCount: countDistinct(routeSegments.routeId) })
			.from(segments)
			.innerJoin(fromStation, eq(fromStation.id, segments.fromStationId))
			.innerJoin(toStation, eq(toStation.id, segments.toStationId))
			.leftJoin(routeSegments, eq(routeSegments.segmentId, segments.id));
	}

	// GROUP BY に select した列を全部入れるのは、ONLY_FULL_GROUP_BY の関数従属（PK だけで済む）に
	// 寄りかからないため（01-architecture.md 6.1 の縛り4）。
	const groupBySegment = [
		columns.id,
		columns.fromStationId,
		columns.fromStationName,
		columns.toStationId,
		columns.toStationName,
		columns.oneWayFare,
	] as const;

	// 1-7 の PUT / DELETE が、無い区間を 404 に、使用中を 409 に分けるために読む。
	// 使われているかどうかは routeCount で分かるので、専用の数え方を持たない。
	async function findById(id: number): Promise<Segment | null> {
		const rows = await withRouteCount()
			.where(eq(segments.id, id))
			.groupBy(...groupBySegment);
		return rows[0] ?? null;
	}

	return {
		// 出発駅名 → 到着駅名の順。配列の順序がそのまま画面の順序である（04-api.md 5.1 の流儀）。
		// 駅一覧が名前順なのに揃える。照合順序 utf8mb4_ja_0900_as_cs の並びになる。
		async list(): Promise<Segment[]> {
			return withRouteCount()
				.groupBy(...groupBySegment)
				.orderBy(fromStation.name, toStation.name);
		},

		findById,

		// 重複の先読み用（03-database.md 10.2。UNIQUE をアプリ側検証の代わりにしない）。
		// id を返すのは、1-7 の PUT が「判定から自分自身を除く」ため（04-api.md 4.7）。
		// UNIQUE (from, to) は順序付きなので、逆向きの駅ペアは別の区間である
		async findIdByStationPair(fromStationId: number, toStationId: number): Promise<number | null> {
			const rows = await db
				.select({ id: segments.id })
				.from(segments)
				.where(
					and(eq(segments.fromStationId, fromStationId), eq(segments.toStationId, toStationId)),
				)
				.limit(1);
			return rows[0]?.id ?? null;
		},

		// 駅名を含めて返すために、入れたあと findById で読み直す。
		// 返り値を repository の中で完結させ、呼び出し側に駅名を持ち回らせない
		async create(input: SegmentInput): Promise<Segment> {
			// DB 既定値が無いのでアプリが入れる。UTC（03-database.md 4.2）
			const now = new Date();
			let id: number;
			try {
				const [row] = await db
					.insert(segments)
					.values({ ...input, createdAt: now, updatedAt: now })
					.$returningId();
				if (!row) throw new Error('segments の insert が id を返さなかった');
				id = row.id;
			} catch (cause) {
				// 二重の網。services の先読みをすり抜けた重複と「駅が無い」（先読みの後に駅が消された）を、
				// 同じ 409 / 422 に写す。segments の UNIQUE は駅ペアの1本だけなので、制約名までは見ない。
				// 同一駅の CHECK と負の運賃の UNSIGNED は routes が確定的に弾くので、ここでは写さない
				if (isDuplicateEntry(cause)) throw new AppError('SEGMENT_DUPLICATED', { cause });
				if (isNoReferencedRow(cause)) {
					throw new AppError('INVALID_VALUE', { message: '指定した駅が見つかりません', cause });
				}
				throw cause;
			}
			const created = await findById(id);
			if (created === null) throw new Error(`入れたばかりの区間 ${id} を読み直せなかった`);
			return created;
		},

		// 3列とも受け取る。使用中なら駅を変えられない（決定22）が、それは services が先に決めて
		// 現在値を詰めて渡してくる。repository は「何が変わるか」を知らない。
		async update(id: number, input: SegmentInput): Promise<Segment> {
			try {
				await db
					.update(segments)
					.set({ ...input, updatedAt: new Date() })
					.where(eq(segments.id, id));
			} catch (cause) {
				// create と同じ二重の網。判定から自分自身を除いた先読みをすり抜けた重複と「駅が無い」を写す
				if (isDuplicateEntry(cause)) throw new AppError('SEGMENT_DUPLICATED', { cause });
				if (isNoReferencedRow(cause)) {
					throw new AppError('INVALID_VALUE', { message: '指定した駅が見つかりません', cause });
				}
				throw cause;
			}
			const updated = await findById(id);
			if (updated === null) throw new Error(`直したばかりの区間 ${id} を読み直せなかった`);
			return updated;
		},

		// delete は予約語で repository.delete(…) が読みにくいので remove にする（stations と同じ）。
		async remove(id: number): Promise<void> {
			try {
				await db.delete(segments).where(eq(segments.id, id));
			} catch (cause) {
				// 二重の網。services の先読みをすり抜けた「使用中」を、同じ 409 に写す。
				// segments を参照する外部キーは route_segments の1本だけなので、制約名までは見ない
				if (isRowReferenced(cause)) throw new AppError('SEGMENT_IN_USE', { cause });
				throw cause;
			}
		},
	};
}

export type SegmentsRepository = ReturnType<typeof createSegmentsRepository>;

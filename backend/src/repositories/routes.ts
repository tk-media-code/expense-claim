import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import type { Database } from '../db/client.js';
import { routeSegments, routes, segments, stations } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import type { Route, RouteLeg } from '../domain/route.js';
import { isDuplicateEntry, isNoReferencedRow } from './mysql-error.js';

/** 登録・更新に要るもの。sort_order は segmentIds の配列順からここで振る（04-api.md 3.2） */
export type RouteInput = { venueId: number; name: string; segmentIds: number[] };

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 呼び出し側が受け取るのは domain の型だけである。
export function createRoutesRepository(db: Database) {
	// 出発駅と到着駅で stations を2回引く。同じテーブルなので別名が要る（segments と同じ）
	const fromStation = alias(stations, 'from_station');
	const toStation = alias(stations, 'to_station');

	async function legsOf(routeId: number): Promise<RouteLeg[]> {
		return db
			.select({
				sortOrder: routeSegments.sortOrder,
				segmentId: routeSegments.segmentId,
				fromStationName: fromStation.name,
				toStationName: toStation.name,
				oneWayFare: segments.oneWayFare,
			})
			.from(routeSegments)
			.innerJoin(segments, eq(segments.id, routeSegments.segmentId))
			.innerJoin(fromStation, eq(fromStation.id, segments.fromStationId))
			.innerJoin(toStation, eq(toStation.id, segments.toStationId))
			.where(eq(routeSegments.routeId, routeId))
			.orderBy(asc(routeSegments.sortOrder));
	}

	async function findById(id: number): Promise<Route | null> {
		const rows = await db
			.select({ id: routes.id, venueId: routes.venueId, name: routes.name })
			.from(routes)
			.where(eq(routes.id, id))
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return { ...row, legs: await legsOf(id) };
	}

	// 並びは配列順から 1 始まりで振る。クライアントは sort_order を1度も計算しない（04-api.md 3.2）
	function legRows(routeId: number, segmentIds: number[], at: Date) {
		return segmentIds.map((segmentId, index) => ({
			routeId,
			sortOrder: index + 1,
			segmentId,
			createdAt: at,
			updatedAt: at,
		}));
	}

	// 二重の網。services の先読みをすり抜けた重複と「会場か区間が無い」を、同じ 409 / 422 に写す。
	// routes の UNIQUE は (venue_id, name) の1本だけなので、制約名までは見ない。
	// 参照先が無いのは venues.id と segments.id の2つがありうるが、どちらも先読みの後に消された
	// 稀な競合なので、制約名を読んで文面を分けない
	function rethrow(cause: unknown): never {
		if (isDuplicateEntry(cause)) throw new AppError('ROUTE_NAME_DUPLICATED', { cause });
		if (isNoReferencedRow(cause)) {
			throw new AppError('INVALID_VALUE', {
				message: '指定した会場または区間が見つかりません',
				cause,
			});
		}
		throw cause;
	}

	return {
		findById,

		// 重複の先読み用。id を返すのは、PUT が「判定から自分自身を除く」ため（stations と同じ）
		async findIdByVenueAndName(venueId: number, name: string): Promise<number | null> {
			const rows = await db
				.select({ id: routes.id })
				.from(routes)
				.where(and(eq(routes.venueId, venueId), eq(routes.name, name)))
				.limit(1);
			return rows[0]?.id ?? null;
		},

		// ルートと並びを1組で書く。片方だけ入った状態を作らない。
		// 外部呼び出しをまたがず DB の中で完結する不変条件なので、トランザクションで囲む（06-error-handling.md 6.1）
		async create(input: RouteInput): Promise<Route> {
			const now = new Date();
			let id: number;
			try {
				id = await db.transaction(async (tx) => {
					const [row] = await tx
						.insert(routes)
						.values({ venueId: input.venueId, name: input.name, createdAt: now, updatedAt: now })
						.$returningId();
					if (!row) throw new Error('routes の insert が id を返さなかった');
					await tx.insert(routeSegments).values(legRows(row.id, input.segmentIds, now));
					return row.id;
				});
			} catch (cause) {
				rethrow(cause);
			}
			const created = await findById(id);
			if (created === null) throw new Error(`入れたばかりのルート ${id} を読み直せなかった`);
			return created;
		},

		// segmentIds の配列ごと置き換える（04-api.md 4.7）。並びはルートの部品なので、
		// 差分を取らずに消して入れ直す。UNIQUE (route_id, sort_order) に当たらない順序で行う
		async update(id: number, input: RouteInput): Promise<Route> {
			const now = new Date();
			try {
				await db.transaction(async (tx) => {
					await tx
						.update(routes)
						.set({ venueId: input.venueId, name: input.name, updatedAt: now })
						.where(eq(routes.id, id));
					await tx.delete(routeSegments).where(eq(routeSegments.routeId, id));
					await tx.insert(routeSegments).values(legRows(id, input.segmentIds, now));
				});
			} catch (cause) {
				rethrow(cause);
			}
			const updated = await findById(id);
			if (updated === null) throw new Error(`直したばかりのルート ${id} を読み直せなかった`);
			return updated;
		},

		// 並びは CASCADE で落ち、区間そのものは残る（03-database.md 6.2）。
		// delete は予約語で repository.delete(…) が読みにくいので remove にする
		async remove(id: number): Promise<void> {
			await db.delete(routes).where(eq(routes.id, id));
		},
	};
}

export type RoutesRepository = ReturnType<typeof createRoutesRepository>;

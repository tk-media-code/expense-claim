import { count, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { routeSegments, routes, segments, venues } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import type { Venue, VenueRoute, VenueSource } from '../domain/venue.js';
import { isDuplicateEntry } from './mysql-error.js';

/** 登録に要る列。id はサーバーが決め、source は入口ごとに固定する（04-api.md 7章） */
export type VenueInput = { code: string; name: string; source: VenueSource };

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 呼び出し側が受け取るのは domain の型だけである。
export function createVenuesRepository(db: Database) {
	// ルートごとの区間数と片道合計。route_segments に UNIQUE (route_id, segment_id) が無く
	// 同じ区間を2回使えるので、区間数は行数で数え、合計もそのぶん足す（通った回数ぶん払う）。
	// SUM は DECIMAL で文字列になるので、Number に写す
	async function routesByVenue(): Promise<Map<number, VenueRoute[]>> {
		const rows = await db
			.select({
				id: routes.id,
				venueId: routes.venueId,
				name: routes.name,
				segmentCount: count(routeSegments.id),
				oneWayTotal: sql<number>`coalesce(sum(${segments.oneWayFare}), 0)`.mapWith(Number),
			})
			.from(routes)
			.leftJoin(routeSegments, eq(routeSegments.routeId, routes.id))
			.leftJoin(segments, eq(segments.id, routeSegments.segmentId))
			// GROUP BY に select した列を全部入れるのは、ONLY_FULL_GROUP_BY の関数従属に寄りかからないため
			.groupBy(routes.id, routes.venueId, routes.name)
			.orderBy(routes.name);
		const byVenue = new Map<number, VenueRoute[]>();
		for (const { venueId, ...route } of rows) {
			const list = byVenue.get(venueId) ?? [];
			list.push(route);
			byVenue.set(venueId, list);
		}
		return byVenue;
	}

	const columns = { id: venues.id, code: venues.code, name: venues.name, source: venues.source };

	return {
		// 会場コード順。配列の順序がそのまま画面の順序である（04-api.md 5.1 の流儀）。
		// 43件を全件返し、絞り込みは画面が行う（F-38 / 04-api.md 4.7）
		async list(): Promise<Venue[]> {
			const [rows, byVenue] = await Promise.all([
				db.select(columns).from(venues).orderBy(venues.code),
				routesByVenue(),
			]);
			return rows.map((row) => ({ ...row, routes: byVenue.get(row.id) ?? [] }));
		},

		async findById(id: number): Promise<Venue | null> {
			const rows = await db.select(columns).from(venues).where(eq(venues.id, id)).limit(1);
			const row = rows[0];
			if (!row) return null;
			const byVenue = await routesByVenue();
			return { ...row, routes: byVenue.get(row.id) ?? [] };
		},

		// 重複の先読み用（03-database.md 10.2。UNIQUE をアプリ側検証の代わりにしない）
		async findIdByCode(code: string): Promise<number | null> {
			const rows = await db
				.select({ id: venues.id })
				.from(venues)
				.where(eq(venues.code, code))
				.limit(1);
			return rows[0]?.id ?? null;
		},

		async create(input: VenueInput): Promise<Venue> {
			// DB 既定値が無いのでアプリが入れる。UTC（03-database.md 4.2）
			const now = new Date();
			try {
				const [row] = await db
					.insert(venues)
					.values({ ...input, createdAt: now, updatedAt: now })
					.$returningId();
				if (!row) throw new Error('venues の insert が id を返さなかった');
				return { id: row.id, ...input, routes: [] };
			} catch (cause) {
				// 二重の網。services の先読みをすり抜けた重複を、同じ 409 に写す。
				// venues の UNIQUE は code の1本だけなので、制約名までは見ない
				if (isDuplicateEntry(cause)) throw new AppError('VENUE_CODE_DUPLICATED', { cause });
				throw cause;
			}
		},
	};
}

export type VenuesRepository = ReturnType<typeof createVenuesRepository>;

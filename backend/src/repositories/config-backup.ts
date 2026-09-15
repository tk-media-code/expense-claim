import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import type { Database } from '../db/client.js';
import { routeSegments, routes, segments, stations, venues } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import type { ConfigBackup } from '../domain/config-backup.js';

export type ConfigData = Omit<ConfigBackup, 'version' | 'exportedAt'>;

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
export function createConfigBackupRepository(db: Database) {
	const fromStation = alias(stations, 'from_station');
	const toStation = alias(stations, 'to_station');

	return {
		// 設定データを全部読む。並びは名前順・コード順で、控えの差分が読めるようにする
		async exportAll(): Promise<ConfigData> {
			const stationRows = await db
				.select({ name: stations.name })
				.from(stations)
				.orderBy(asc(stations.name));
			const venueRows = await db
				.select({ code: venues.code, name: venues.name, source: venues.source })
				.from(venues)
				.orderBy(asc(venues.code));
			const segmentRows = await db
				.select({
					fromStation: fromStation.name,
					toStation: toStation.name,
					oneWayFare: segments.oneWayFare,
				})
				.from(segments)
				.innerJoin(fromStation, eq(fromStation.id, segments.fromStationId))
				.innerJoin(toStation, eq(toStation.id, segments.toStationId))
				.orderBy(asc(fromStation.name), asc(toStation.name));
			const routeRows = await db
				.select({ id: routes.id, venueCode: venues.code, name: routes.name })
				.from(routes)
				.innerJoin(venues, eq(venues.id, routes.venueId))
				.orderBy(asc(venues.code), asc(routes.name));
			const legRows = await db
				.select({
					routeId: routeSegments.routeId,
					sortOrder: routeSegments.sortOrder,
					fromStation: fromStation.name,
					toStation: toStation.name,
				})
				.from(routeSegments)
				.innerJoin(segments, eq(segments.id, routeSegments.segmentId))
				.innerJoin(fromStation, eq(fromStation.id, segments.fromStationId))
				.innerJoin(toStation, eq(toStation.id, segments.toStationId))
				.orderBy(asc(routeSegments.routeId), asc(routeSegments.sortOrder));
			return {
				stations: stationRows,
				venues: venueRows,
				segments: segmentRows,
				routes: routeRows.map((route) => ({
					venueCode: route.venueCode,
					name: route.name,
					segments: legRows
						.filter((leg) => leg.routeId === route.id)
						.map((leg) => ({ fromStation: leg.fromStation, toStation: leg.toStation })),
				})),
			};
		},

		// 置き換える。設定データ5テーブルを消してから入れ直す。全部を1つのトランザクションで囲む
		// （外部呼び出しをまたがず、DB の中で完結する。06-error-handling.md 6.1）。
		// 実績データは触らない。expense_records → routes は SET NULL で、ルートが消えても実績は自立している
		// （03-database.md 7章）
		async replaceAll(backup: ConfigData): Promise<void> {
			const now = new Date();
			const key = (from: string, to: string) => `${from}\t${to}`;
			await db.transaction(async (tx) => {
				await tx.delete(routeSegments);
				await tx.delete(routes);
				await tx.delete(segments);
				await tx.delete(stations);
				await tx.delete(venues);

				const stationIds = new Map<string, number>();
				for (const station of backup.stations) {
					const [row] = await tx
						.insert(stations)
						.values({ name: station.name, createdAt: now, updatedAt: now })
						.$returningId();
					if (!row) throw new Error('stations の insert が id を返さなかった');
					stationIds.set(station.name, row.id);
				}
				const venueIds = new Map<string, number>();
				for (const venue of backup.venues) {
					const [row] = await tx
						.insert(venues)
						.values({ ...venue, createdAt: now, updatedAt: now })
						.$returningId();
					if (!row) throw new Error('venues の insert が id を返さなかった');
					venueIds.set(venue.code, row.id);
				}
				const segmentIds = new Map<string, number>();
				for (const segment of backup.segments) {
					const fromStationId = stationIds.get(segment.fromStation);
					const toStationId = stationIds.get(segment.toStation);
					if (fromStationId === undefined || toStationId === undefined) {
						throw new AppError('INVALID_VALUE', {
							message: `区間「${segment.fromStation} → ${segment.toStation}」の駅が控えの駅一覧にありません`,
						});
					}
					const [row] = await tx
						.insert(segments)
						.values({
							fromStationId,
							toStationId,
							oneWayFare: segment.oneWayFare,
							createdAt: now,
							updatedAt: now,
						})
						.$returningId();
					if (!row) throw new Error('segments の insert が id を返さなかった');
					segmentIds.set(key(segment.fromStation, segment.toStation), row.id);
				}
				for (const route of backup.routes) {
					const venueId = venueIds.get(route.venueCode);
					if (venueId === undefined) {
						throw new AppError('INVALID_VALUE', {
							message: `ルート「${route.name}」の会場 ${route.venueCode} が控えの会場一覧にありません`,
						});
					}
					const [row] = await tx
						.insert(routes)
						.values({ venueId, name: route.name, createdAt: now, updatedAt: now })
						.$returningId();
					if (!row) throw new Error('routes の insert が id を返さなかった');
					const legs = route.segments.map((leg, index) => {
						const segmentId = segmentIds.get(key(leg.fromStation, leg.toStation));
						if (segmentId === undefined) {
							throw new AppError('INVALID_VALUE', {
								message: `ルート「${route.name}」の区間「${leg.fromStation} → ${leg.toStation}」が控えの区間一覧にありません`,
							});
						}
						return {
							routeId: row.id,
							sortOrder: index + 1,
							segmentId,
							createdAt: now,
							updatedAt: now,
						};
					});
					if (legs.length > 0) await tx.insert(routeSegments).values(legs);
				}
			});
		},
	};
}

export type ConfigBackupRepository = ReturnType<typeof createConfigBackupRepository>;

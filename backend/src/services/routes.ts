import { AppError } from '../domain/app-error.js';
import type { Route } from '../domain/route.js';
import type { RouteInput, RoutesRepository } from '../repositories/routes.js';
import type { SegmentsRepository } from '../repositories/segments.js';
import type { VenuesRepository } from '../repositories/venues.js';

// 業務ロジックはここ。routes は services だけを呼ぶ（01-architecture.md 5.2）。
// 入力の形の検証（空・長さ・配列の要素）は routes が済ませて渡してくる（5.1）。
export function createRoutesService(
	repository: RoutesRepository,
	venuesRepository: VenuesRepository,
	segmentsRepository: SegmentsRepository,
) {
	// FK をアプリ側検証の代わりにしない（03-database.md 10.2）ので先に読む。
	// 本文の id が無い行を指すのは URL の :id が無いのとは違い本文の値の問題なので、422 にする（#112 の判断1）
	async function ensureReferences(input: RouteInput): Promise<void> {
		if ((await venuesRepository.findById(input.venueId)) === null) {
			throw new AppError('INVALID_VALUE', { message: '会場が見つかりません' });
		}
		for (const segmentId of input.segmentIds) {
			if ((await segmentsRepository.findById(segmentId)) === null) {
				throw new AppError('INVALID_VALUE', { message: '区間が見つかりません' });
			}
		}
	}

	return {
		async get(id: number): Promise<Route> {
			const route = await repository.findById(id);
			if (route === null) throw new AppError('NOT_FOUND');
			return route;
		},

		// 同じ会場に同じ名前のルートを2本持たせない（03-database.md 5.1）。別の会場なら同じ名前でよい
		async create(input: RouteInput): Promise<Route> {
			await ensureReferences(input);
			if ((await repository.findIdByVenueAndName(input.venueId, input.name)) !== null) {
				throw new AppError('ROUTE_NAME_DUPLICATED');
			}
			return repository.create(input);
		},

		// segmentIds の配列ごと置き換える（04-api.md 4.7）。重複の判定からは自分自身を除く
		async update(id: number, input: RouteInput): Promise<Route> {
			if ((await repository.findById(id)) === null) throw new AppError('NOT_FOUND');
			await ensureReferences(input);
			const duplicated = await repository.findIdByVenueAndName(input.venueId, input.name);
			if (duplicated !== null && duplicated !== id) throw new AppError('ROUTE_NAME_DUPLICATED');
			return repository.update(id, input);
		},

		// 使う区間の並びだけが消え（CASCADE）、区間そのものは残る（04-api.md 4.7）。
		// 記録が参照していても消せる。routes → expense_records は SET NULL で、実績は自立している（03-database.md 7章）
		async remove(id: number): Promise<void> {
			if ((await repository.findById(id)) === null) throw new AppError('NOT_FOUND');
			await repository.remove(id);
		},
	};
}

export type RoutesService = ReturnType<typeof createRoutesService>;

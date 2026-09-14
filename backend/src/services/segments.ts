import { AppError } from '../domain/app-error.js';
import type { Segment } from '../domain/segment.js';
import type { SegmentInput, SegmentsRepository } from '../repositories/segments.js';
import type { StationsRepository } from '../repositories/stations.js';

// 業務ロジックはここ。routes は services だけを呼ぶ（01-architecture.md 5.2）。
// 入力の形の検証（同一駅・負の運賃・上限）は routes が済ませて渡してくる（5.1）。
export function createSegmentsService(
	repository: SegmentsRepository,
	stationsRepository: StationsRepository,
) {
	return {
		list(): Promise<Segment[]> {
			return repository.list();
		},

		// UNIQUE / FK をアプリ側検証の代わりにしない（03-database.md 10.2）ので先に読む。
		// すり抜けたもの（競合）は repository が同じ AppError に写す（二重の網）。
		async create(input: SegmentInput): Promise<Segment> {
			// 本文の駅 id が無い駅を指すのは、URL の :id が無いのとは違い本文の値の問題なので、
			// 同一駅・負の運賃と同じ 422 に揃える（04-api.md 4.7）。どちらの駅かを文面で言う
			if ((await stationsRepository.findById(input.fromStationId)) === null) {
				throw new AppError('INVALID_VALUE', { message: '出発駅が見つかりません' });
			}
			if ((await stationsRepository.findById(input.toStationId)) === null) {
				throw new AppError('INVALID_VALUE', { message: '到着駅が見つかりません' });
			}

			// 同じ駅ペアに運賃を2つ持たせない（決定18 / 04-api.md 4.7）。逆向きは別の区間として通す
			const duplicated = await repository.findIdByStationPair(
				input.fromStationId,
				input.toStationId,
			);
			if (duplicated !== null) throw new AppError('SEGMENT_DUPLICATED');

			return repository.create(input);
		},
	};
}

export type SegmentsService = ReturnType<typeof createSegmentsService>;

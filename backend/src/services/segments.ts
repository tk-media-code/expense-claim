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

		// 片道運賃は常に直せる。出発駅・到着駅はどのルートも使っていないときだけ（決定22 / 04-api.md 4.7）。
		// 区間は複数のルートで共有されるので（決定18）、駅を差し替えるとそのルートすべてが誰も触って
		// いないのに別の経路になる。使っているルートが0本なら、変わるものが無い。
		async update(id: number, input: SegmentUpdateInput): Promise<Segment> {
			const current = await repository.findById(id);
			if (current === null) throw new AppError('NOT_FOUND');

			const stationGiven = input.fromStationId !== undefined || input.toStationId !== undefined;
			if (stationGiven && current.routeCount > 0) {
				// 削除と同じ code で、文面だけ「変えられない」に寄せる。本人がすることは同じである
				throw new AppError('SEGMENT_IN_USE', {
					message: 'この区間を使っているルートがあるため、出発駅・到着駅は変えられません',
				});
			}

			// 片方だけ送られてもよい。送られなかった側は現在値のまま
			const next: SegmentInput = {
				fromStationId: input.fromStationId ?? current.fromStationId,
				toStationId: input.toStationId ?? current.toStationId,
				oneWayFare: input.oneWayFare,
			};

			// 同一駅は差し替え後の組で見る。片方だけ送られたときは routes の zod では決められない
			if (next.fromStationId === next.toStationId) {
				throw new AppError('INVALID_VALUE', { message: '出発駅と到着駅は別の駅にしてください' });
			}

			// 変わる駅だけ存在を先読みする（create と同じ 422）
			if (next.fromStationId !== current.fromStationId) {
				if ((await stationsRepository.findById(next.fromStationId)) === null) {
					throw new AppError('INVALID_VALUE', { message: '出発駅が見つかりません' });
				}
			}
			if (next.toStationId !== current.toStationId) {
				if ((await stationsRepository.findById(next.toStationId)) === null) {
					throw new AppError('INVALID_VALUE', { message: '到着駅が見つかりません' });
				}
			}

			// 重複の判定からは自分自身を除く（04-api.md 4.7）
			const duplicated = await repository.findIdByStationPair(next.fromStationId, next.toStationId);
			if (duplicated !== null && duplicated !== id) throw new AppError('SEGMENT_DUPLICATED');

			return repository.update(id, next);
		},

		// どのルートも使っていないときだけ消せる（決定22 / F-37）。
		// 03-database.md 6.2 の segments → route_segments は RESTRICT で、DB もこれを拒む。
		// ここは RESTRICT を先回りして 409 に言い直しているだけである（stations と同じ）。
		async remove(id: number): Promise<void> {
			const current = await repository.findById(id);
			if (current === null) throw new AppError('NOT_FOUND');
			if (current.routeCount > 0) throw new AppError('SEGMENT_IN_USE');
			await repository.remove(id);
		},
	};
}

/** PUT の本文。駅は任意で、送られなかった側は現在値のまま（04-api.md 4.7） */
export type SegmentUpdateInput = {
	oneWayFare: number;
	fromStationId?: number;
	toStationId?: number;
};

export type SegmentsService = ReturnType<typeof createSegmentsService>;

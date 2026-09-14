import { AppError } from '../domain/app-error.js';
import type { Station } from '../domain/station.js';
import type { StationsRepository } from '../repositories/stations.js';

// 業務ロジックはここ。routes は services だけを呼ぶ（01-architecture.md 5.2）。
// 入力の形の検証（空・長さ）は routes が済ませて渡してくる（5.1）。
export function createStationsService(repository: StationsRepository) {
	return {
		list(): Promise<Station[]> {
			return repository.list();
		},

		// 駅名が既存と重複したら 409（04-api.md 4.7）。
		// UNIQUE をアプリ側検証の代わりにしない（03-database.md 10.2）ので先に読む。
		// すり抜けた重複は repository が同じ AppError に写す（二重の網）。
		async create(input: { name: string }): Promise<Station> {
			if ((await repository.findIdByName(input.name)) !== null) {
				throw new AppError('STATION_NAME_DUPLICATED');
			}
			return repository.create(input.name);
		},

		// 名前は使われていても直せる（決定22 / 04-api.md 4.7）。segmentCount を見ない。
		// 使われている駅は消せないので、区間を組んだあとに打ち間違いへ気づくと
		// リネーム以外に道が残らない。済んだ記録は記録時点の文字列で持つので動かない。
		async update(id: number, input: { name: string }): Promise<Station> {
			const current = await repository.findById(id);
			if (current === null) throw new AppError('NOT_FOUND');

			// 重複の判定からは自分自身を除く（04-api.md 4.7）。
			// findIdByName が真偽でなく id を返すのは、このためである。
			const duplicated = await repository.findIdByName(input.name);
			if (duplicated !== null && duplicated !== id) {
				throw new AppError('STATION_NAME_DUPLICATED');
			}

			await repository.update(id, input.name);
			// 改名で区間の数は変わらない
			return { ...current, name: input.name };
		},

		// どの区間も使っていないときだけ消せる（決定22 / F-15）。
		// 03-database.md 6.2 の stations → segments は RESTRICT で、DB もこれを拒む。
		// ここは RESTRICT を先回りして 409 に言い直しているだけである。
		async remove(id: number): Promise<void> {
			const current = await repository.findById(id);
			if (current === null) throw new AppError('NOT_FOUND');
			if (current.segmentCount > 0) throw new AppError('STATION_IN_USE');
			await repository.remove(id);
		},
	};
}

export type StationsService = ReturnType<typeof createStationsService>;

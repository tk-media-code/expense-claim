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
	};
}

export type StationsService = ReturnType<typeof createStationsService>;

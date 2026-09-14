import { AppError } from '../domain/app-error.js';
import type { Venue } from '../domain/venue.js';
import type { VenuesRepository } from '../repositories/venues.js';

// 業務ロジックはここ。routes は services だけを呼ぶ（01-architecture.md 5.2）。
// 入力の形の検証（空・長さ）は routes が済ませて渡してくる（5.1）。
export function createVenuesService(repository: VenuesRepository) {
	return {
		list(): Promise<Venue[]> {
			return repository.list();
		},

		// 手で足す会場は source = 'manual' 固定（F-14 / 04-api.md 4.7）。リクエストで受け取らない。
		// 受け取ると、取り込んだ会場を手動と偽れる（7章）。
		// 会場コードが既存と重複したら 409。UNIQUE をアプリ側検証の代わりにしない（03-database.md 10.2）ので先に読む
		async create(input: { code: string; name: string }): Promise<Venue> {
			if ((await repository.findIdByCode(input.code)) !== null) {
				throw new AppError('VENUE_CODE_DUPLICATED');
			}
			return repository.create({ ...input, source: 'manual' });
		},
	};
}

export type VenuesService = ReturnType<typeof createVenuesService>;

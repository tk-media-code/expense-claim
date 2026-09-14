import { AppError } from '../domain/app-error.js';
import { totalOf } from '../domain/expense-record.js';
import type { CalendarDate } from '../domain/month.js';
import type { Project, ProjectDetail } from '../domain/project.js';
import type { ExpenseRecordsRepository } from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { RoutesRepository } from '../repositories/routes.js';
import type { VenuesRepository } from '../repositories/venues.js';

/** 手で足すときの本文（02-screens.md 3.4）。会場は会場コードで選び、会場名はサーバーが引く */
export type ProjectCreateInput = {
	projectNo: string;
	serviceDate: CalendarDate;
	venueCode: string;
	coupleName: string;
};

/** 修正の本文（F-11）。どの項目も任意で、送られなかった側は現在値のまま */
export type ProjectUpdateInput = Partial<ProjectCreateInput>;

// 業務ロジックはここ。routes は services だけを呼ぶ（01-architecture.md 5.2）。
// 入力の形の検証（空・長さ・暦日）は routes が済ませて渡してくる（5.1）。
export function createProjectsService(
	repository: ProjectsRepository,
	venuesRepository: VenuesRepository,
	expenseRecordsRepository: ExpenseRecordsRepository,
	routesRepository: RoutesRepository,
) {
	// 会場コードは会場一覧から選ぶ（02-screens.md 3.3 / 3.4）。無いコードは本文の値の問題なので 422。
	// 取り込み（9-4）はこれを通らない。マスタに無いコードの案件も取り込む（03-database.md 8章）
	async function venueNameOf(venueCode: string): Promise<string> {
		const venue = await venuesRepository.findByCode(venueCode);
		if (venue === null) throw new AppError('INVALID_VALUE', { message: '会場が見つかりません' });
		return venue.name;
	}

	// 記録の要約（02-screens.md 3.3）。ルート名は表示用で、ルートが消えていれば null のまま出す
	async function summaryOf(projectId: number): Promise<ProjectDetail['record']> {
		const record = await expenseRecordsRepository.findByProjectId(projectId);
		if (record === null) return null;
		const nameOf = async (routeId: number | null) =>
			routeId === null ? null : ((await routesRepository.findById(routeId))?.name ?? null);
		return {
			tripType: record.tripType,
			total: totalOf(record.legs),
			outboundRouteName: await nameOf(record.outboundRouteId),
			returnRouteName: await nameOf(record.returnRouteId),
			recordedAt: record.recordedAt,
		};
	}

	return {
		// 詳細は資源単位（04-api.md 3.1）だが、3.3 の「記録の要約」はここに載る
		async get(id: number): Promise<ProjectDetail> {
			const project = await repository.findById(id);
			if (project === null) throw new AppError('NOT_FOUND');
			return { ...project, record: await summaryOf(id), taxiCount: 0 };
		},

		// 手で足す案件は source = 'manual' 固定（F-10 / 04-api.md 4.4）。
		// 案件番号が既存と重複したら 409。UNIQUE をアプリ側検証の代わりにしない（03-database.md 10.2）ので先に読む
		async create(input: ProjectCreateInput): Promise<Project> {
			if ((await repository.findIdByProjectNo(input.projectNo)) !== null) {
				throw new AppError('PROJECT_NO_DUPLICATED');
			}
			const venueName = await venueNameOf(input.venueCode);
			return repository.create({ ...input, venueName, source: 'manual' });
		},

		// 施行日を直すと所属月度が変わる（04-api.md 4.4）。月度は列に無く導出なので、直すだけで変わる。
		// 重複の判定からは自分自身を除く
		async update(id: number, input: ProjectUpdateInput): Promise<Project> {
			if ((await repository.findById(id)) === null) throw new AppError('NOT_FOUND');
			if (input.projectNo !== undefined) {
				const duplicated = await repository.findIdByProjectNo(input.projectNo);
				if (duplicated !== null && duplicated !== id) {
					throw new AppError('PROJECT_NO_DUPLICATED');
				}
			}
			// 会場コードを直せば会場名も連動する（02-screens.md 3.3）
			const venueName =
				input.venueCode === undefined ? undefined : await venueNameOf(input.venueCode);
			return repository.update(id, { ...input, venueName });
		},

		// 紐づく記録・乗車・領収書の行も消える（F-12）。ドライブの実体は消さない（要件定義 6.4）
		async remove(id: number): Promise<void> {
			if ((await repository.findById(id)) === null) throw new AppError('NOT_FOUND');
			await repository.remove(id);
		},
	};
}

export type ProjectsService = ReturnType<typeof createProjectsService>;

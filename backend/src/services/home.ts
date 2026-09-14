import type { Home, HomeMonth, HomeProject } from '../domain/home.js';
import { firstDayOf, isSameMonth, type ProjectMonth } from '../domain/month.js';
import type { Project } from '../domain/project.js';
import type { AttentionsRepository } from '../repositories/attentions.js';
import type {
	ExpenseRecordSummary,
	ExpenseRecordsRepository,
} from '../repositories/expense-records.js';
import type { ProjectsRepository } from '../repositories/projects.js';
import type { SyncStateRepository } from '../repositories/sync-state.js';

// ホームの集約（04-api.md 4.3 / 5.1）。DB しか読まない。外部 API を叩かない。
// 取り込みの完了を待たずに一覧を出す（02-screens.md 3.2）ために、同期（POST /api/sync）とは別のリクエストである。
export function createHomeService(
	projectsRepository: ProjectsRepository,
	syncStateRepository: SyncStateRepository,
	expenseRecordsRepository: ExpenseRecordsRepository,
	attentionsRepository: AttentionsRepository,
) {
	// 記録の済み／未（F-21 / 02-screens.md 4.1）。Phase 11-7 で提出状態、7-3 で要確認件数、10 でタクシーが乗る
	function toHomeProject(project: Project, record: ExpenseRecordSummary | undefined): HomeProject {
		return {
			id: project.id,
			projectNo: project.projectNo,
			serviceDate: project.serviceDate,
			venueCode: project.venueCode,
			venueName: project.venueName,
			coupleName: project.coupleName,
			recorded: record !== undefined,
			totalAmount: record?.total ?? null,
			taxiCount: 0,
		};
	}

	return {
		async get(): Promise<Home> {
			const syncState = await syncStateRepository.find();
			const targetMonth = syncState?.lastSeenTargetMonth ?? null;

			// 提出待ちの月度と、それ以降の施行日を持つ案件（F-09）。並びは repository が決めている
			const projects = await projectsRepository.listFrom(
				targetMonth === null ? null : firstDayOf(targetMonth),
			);

			// 記録の有無は案件ごとに読まず、1クエリでまとめて引く（月6〜10件ぶん往復させない）
			const records = await expenseRecordsRepository.summarize(projects.map((p) => p.id));

			// 月度ごとに束ねる。案件は施行日の昇順で来るので、月度も昇順に並ぶ。最後に降順へ返す
			const byMonth = new Map<ProjectMonth, HomeMonth>();
			for (const project of projects) {
				let month = byMonth.get(project.month);
				if (!month) {
					month = {
						month: project.month,
						// 対象月度なら提出待ち、それより後ならこれから稼働（02-screens.md 4.2）。
						// 対象月度より前の案件は listFrom が返さない（提出せずに残ったものは要確認事項で気づく）。
						// 対象月度が分からないうちは、どれも提出待ちとして扱わない
						state:
							targetMonth !== null && isSameMonth(project.month, targetMonth) ? 'due' : 'upcoming',
						submittedAt: null,
						projects: [],
					};
					byMonth.set(project.month, month);
				}
				month.projects.push(toHomeProject(project, records.get(project.id)));
			}

			return {
				targetMonth,
				lastImportedAt: syncState?.lastImportedAt ?? null,
				lastCronRunAt: syncState?.lastCronRunAt ?? null,
				// 未確認だけを数える（02-screens.md 4.4）。0件のとき出さないのはクライアントの判断
				attentionCount: await attentionsRepository.countUnchecked(),
				months: [...byMonth.values()].reverse(),
			};
		},
	};
}

export type HomeService = ReturnType<typeof createHomeService>;

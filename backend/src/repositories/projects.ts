import { and, asc, eq, exists, gte, lt, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { projects, submissions } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import {
	firstDayOf,
	firstDayOfNextMonth,
	parseCalendarDate,
	projectMonthOf,
	type CalendarDate,
	type TargetMonth,
} from '../domain/month.js';
import type { Project, ProjectSource } from '../domain/project.js';
import { isDuplicateEntry } from './mysql-error.js';

/** 登録に要る列。id と month はサーバーが決め、source は入口ごとに固定する（04-api.md 7章） */
export type ProjectInput = {
	projectNo: string;
	serviceDate: CalendarDate;
	venueCode: string;
	venueName: string;
	coupleName: string;
	source: ProjectSource;
};

/** 修正できる列（F-11）。source は変えられない */
export type ProjectPatch = Partial<Omit<ProjectInput, 'source'>>;

type Row = {
	id: number;
	projectNo: string;
	serviceDate: string;
	venueCode: string;
	venueName: string;
	coupleName: string;
	source: ProjectSource;
};

// Drizzle の型を repositories の外へ出さない（01-architecture.md 5.2）。
// 呼び出し側が受け取るのは domain の型だけである。
export function createProjectsRepository(db: Database) {
	const columns = {
		id: projects.id,
		projectNo: projects.projectNo,
		serviceDate: projects.serviceDate,
		venueCode: projects.venueCode,
		venueName: projects.venueName,
		coupleName: projects.coupleName,
		source: projects.source,
	};

	// DATE 列は文字列で往復する（03-database.md 4.2）。domain には暦日の型と、そこから導出した月度で渡す
	function toProject(row: Row): Project {
		const serviceDate = parseCalendarDate(row.serviceDate);
		if (!serviceDate) throw new Error(`projects.service_date が暦日でない: ${row.serviceDate}`);
		return { ...row, serviceDate, month: projectMonthOf(serviceDate) };
	}

	async function findById(id: number): Promise<Project | null> {
		const rows = await db.select(columns).from(projects).where(eq(projects.id, id)).limit(1);
		return rows[0] ? toProject(rows[0]) : null;
	}

	return {
		findById,

		// ホームに出す範囲（F-09 / 03-database.md 9.1）。「提出待ちの月度と、それ以降の施行日を持つ案件」。
		// カレンダーの月で切らない。from が無ければ（一度も同期していなければ）全件。
		// 並びは施行日の昇順、同じ日なら案件番号の昇順、それでも決まらなければ id（要件定義 5.3）
		async listFrom(from: CalendarDate | null): Promise<Project[]> {
			const rows = await db
				.select(columns)
				.from(projects)
				.where(from === null ? undefined : gte(projects.serviceDate, from))
				.orderBy(asc(projects.serviceDate), asc(projects.projectNo), asc(projects.id));
			return rows.map(toProject);
		},

		// 月度切替の削除（F-32 / 03-database.md 6.3）。切替先より前で、かつ提出が済んだ月度の案件だけを消す。
		// 子（記録・区間の行・乗車・領収書）は CASCADE で落ちる。1文なのでトランザクションを開かない（06-error-handling.md 6.4）
		async deleteSubmittedBefore(target: TargetMonth): Promise<number> {
			const result = await db.delete(projects).where(
				and(
					lt(projects.serviceDate, firstDayOf(target)),
					exists(
						db
							.select({ one: sql`1` })
							.from(submissions)
							.where(
								sql`${submissions.targetMonth} = date_format(${projects.serviceDate}, '%Y-%m-01')`,
							),
					),
				),
			);
			return result[0].affectedRows;
		},

		// 切替先より前に残った案件（提出していない月度）。要確認事項に出す（F-32 / 02-screens.md 4.4）
		async listBefore(target: TargetMonth): Promise<Project[]> {
			const rows = await db
				.select(columns)
				.from(projects)
				.where(lt(projects.serviceDate, firstDayOf(target)))
				.orderBy(asc(projects.serviceDate), asc(projects.projectNo), asc(projects.id));
			return rows.map(toProject);
		},

		// 提出（F-28 / 03-database.md 9.1）。対象月度の案件だけを、施行日の昇順・案件番号の昇順で
		async listInMonth(target: TargetMonth): Promise<Project[]> {
			const rows = await db
				.select(columns)
				.from(projects)
				.where(
					and(
						gte(projects.serviceDate, firstDayOf(target)),
						lt(projects.serviceDate, firstDayOfNextMonth(target)),
					),
				)
				.orderBy(asc(projects.serviceDate), asc(projects.projectNo), asc(projects.id));
			return rows.map(toProject);
		},

		// 重複の先読み用（03-database.md 10.2。UNIQUE をアプリ側検証の代わりにしない）。
		// id を返すのは、PATCH が「判定から自分自身を除く」ため（stations と同じ）
		async findIdByProjectNo(projectNo: string): Promise<number | null> {
			const rows = await db
				.select({ id: projects.id })
				.from(projects)
				.where(eq(projects.projectNo, projectNo))
				.limit(1);
			return rows[0]?.id ?? null;
		},

		async create(input: ProjectInput): Promise<Project> {
			// DB 既定値が無いのでアプリが入れる。UTC（03-database.md 4.2）
			const now = new Date();
			try {
				const [row] = await db
					.insert(projects)
					.values({ ...input, createdAt: now, updatedAt: now })
					.$returningId();
				if (!row) throw new Error('projects の insert が id を返さなかった');
				return { id: row.id, ...input, month: projectMonthOf(input.serviceDate) };
			} catch (cause) {
				// 二重の網。services の先読みをすり抜けた重複を、同じ 409 に写す。
				// projects の UNIQUE はいま project_no の1本だけなので、制約名までは見ない
				if (isDuplicateEntry(cause)) throw new AppError('PROJECT_NO_DUPLICATED', { cause });
				throw cause;
			}
		},

		async update(id: number, patch: ProjectPatch): Promise<Project> {
			try {
				await db
					.update(projects)
					.set({ ...patch, updatedAt: new Date() })
					.where(eq(projects.id, id));
			} catch (cause) {
				if (isDuplicateEntry(cause)) throw new AppError('PROJECT_NO_DUPLICATED', { cause });
				throw cause;
			}
			const updated = await findById(id);
			if (updated === null) throw new Error(`直したばかりの案件 ${id} を読み直せなかった`);
			return updated;
		},

		// 紐づく記録・乗車・領収書の行は CASCADE で落ちる（03-database.md 6.2）。
		// delete は予約語で repository.delete(…) が読みにくいので remove にする
		async remove(id: number): Promise<void> {
			await db.delete(projects).where(eq(projects.id, id));
		},
	};
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;

import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { projects } from '../db/schema.js';
import { AppError } from '../domain/app-error.js';
import { parseCalendarDate, projectMonthOf, type CalendarDate } from '../domain/month.js';
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

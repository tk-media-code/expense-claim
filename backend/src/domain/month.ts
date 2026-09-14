// 「月」の3基準を型で分ける（01-architecture.md 5.4 / 要件定義 1章）。
//
//   カレンダー上の日（当月・前月・翌月）… 時計から。YYYY-MM-DD
//   対象月度 … 提出シートの A1 が決める（決定13）。YYYY-MM
//   案件の月度 … 案件の施行日から導出する（決定12）。YYYY-MM
//
// どれも実体は文字列だが、同じ型にすると取り違えても気づけない。取り違えるとデータが消える
// （月度切替の削除が別の月度を消す）。テストで見つける類の誤りではなく、そもそも書けないようにする。
// 対象月度と案件の月度は書式が同じなので、比較は必ずこのファイルの関数を通す。=== は型が合わずに書けない。
//
// Date オブジェクトを経由しない。暦日を UTC へ寄せると1日ずれて別の月度になる（03-database.md 4.2）。
// domain はどの層にも依存しない（01-architecture.md 5.2）。

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** カレンダー上の暦日。`YYYY-MM-DD`。施行日・乗車日・今日 */
export type CalendarDate = Brand<string, 'CalendarDate'>;
/** 対象月度。提出シートの `A1` が今どの月を受け付けているか。`YYYY-MM` */
export type TargetMonth = Brand<string, 'TargetMonth'>;
/** 案件の月度。施行日が属する月。`YYYY-MM` */
export type ProjectMonth = Brand<string, 'ProjectMonth'>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
	// 翌月の 0 日 = 当月の末日。UTC で計算し、タイムゾーンの影響を受けない
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `YYYY-MM-DD` で、暦の上に実在する日なら CalendarDate。それ以外は null */
export function parseCalendarDate(value: string): CalendarDate | null {
	const m = DATE.exec(value);
	if (!m) return null;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
	return value as CalendarDate;
}

/** 年・月・日から暦日を組む。日が月の末日を越えていれば null */
export function calendarDateOf(year: number, month: number, day: number): CalendarDate | null {
	return parseCalendarDate(`${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`);
}

/** 案件の月度は施行日から導出する（決定12 / N-20）。月度の属性は持たない */
export function projectMonthOf(serviceDate: CalendarDate): ProjectMonth {
	return serviceDate.slice(0, 7) as ProjectMonth;
}

/** 対象月度は提出シートの `A1`（月初の暦日）から決める（決定13）。月初でなければ null */
export function targetMonthOfFirstDay(firstDay: CalendarDate): TargetMonth | null {
	if (!firstDay.endsWith('-01')) return null;
	return firstDay.slice(0, 7) as TargetMonth;
}

/** `YYYY-MM` として読めれば対象月度。API の応答や DB から戻すときに使う */
export function parseTargetMonth(value: string): TargetMonth | null {
	const m = MONTH.exec(value);
	if (!m) return null;
	const month = Number(m[2]);
	if (month < 1 || month > 12) return null;
	return value as TargetMonth;
}

/** 月度の月初。DATE 列（submissions.target_month など）に入れる形 */
export function firstDayOf(month: TargetMonth | ProjectMonth): CalendarDate {
	return `${month}-01` as CalendarDate;
}

/** 翌月の月初。範囲検索の上限（03-database.md 9.1 の `< :target_month + INTERVAL 1 MONTH`） */
export function firstDayOfNextMonth(month: TargetMonth | ProjectMonth): CalendarDate {
	const year = Number(month.slice(0, 4));
	const mon = Number(month.slice(5, 7));
	return mon === 12
		? (`${year + 1}-01-01` as CalendarDate)
		: (`${year}-${pad(mon + 1)}-01` as CalendarDate);
}

/** 施行日がこの対象月度に属するか（提出の絞り込み・F-28） */
export function belongsTo(serviceDate: CalendarDate, target: TargetMonth): boolean {
	return projectMonthOf(serviceDate) === (target as string);
}

/** 案件の月度が対象月度と同じか。「提出待ち」の判定（02-screens.md 4.2） */
export function isSameMonth(month: ProjectMonth, target: TargetMonth): boolean {
	return (month as string) === (target as string);
}

/**
 * 案件の月度が対象月度より前か。月度切替の削除（F-32）と「提出せずに切り替わった」の判定に使う。
 * `YYYY-MM` は文字列の大小がそのまま月の前後になる
 */
export function isBefore(month: ProjectMonth, target: TargetMonth): boolean {
	return (month as string) < (target as string);
}

/** 施行日が今日より後なら「施行前」（02-screens.md 4.1）。今日を含まない */
export function isAfter(serviceDate: CalendarDate, today: CalendarDate): boolean {
	return (serviceDate as string) > (today as string);
}

/**
 * JST の今日。表示と判定は JST で行う（03-database.md 4.2）。
 * UTC で判定すると、日本時間の1日の朝がまだ前月末になる。コンテナの TZ に寄りかからず、明示的にずらす
 */
export function todayInJst(now: Date): CalendarDate {
	const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` as CalendarDate;
}

/** JST の暦日の「日」。提出アラートの「その日が1日か3日か」（要件定義 7.5） */
export function dayOfMonth(date: CalendarDate): number {
	return Number(date.slice(8, 10));
}

/**
 * 提出シートに書く形（`2026/9/5`）。USER_ENTERED で書けば日付として入る（要求分析 5.5・実測）。
 * 0 埋めしない。本人の実際の記入に合わせる
 */
export function formatForSheet(date: CalendarDate): string {
	const [year, month, day] = date.split('-').map(Number);
	return `${year}/${month}/${day}`;
}

/** 画面や文面に出す形（`2026年9月度`） */
export function formatMonthJa(month: TargetMonth | ProjectMonth): string {
	return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月度`;
}

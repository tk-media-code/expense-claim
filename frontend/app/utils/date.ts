// 表示のための日付の扱い。判定は JST で行う（03-database.md 4.2）。
// 暦日（YYYY-MM-DD）は Date を経由すると1日ずれるので、文字列のまま扱う。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** JST の今日を YYYY-MM-DD で返す。ブラウザのタイムゾーンに寄りかからない */
export function todayInJst(now: Date = new Date()): string {
	const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 施行日が今日より後なら施行前（02-screens.md 4.1）。今日を含まない */
export function isUpcoming(serviceDate: string, today: string = todayInJst()): boolean {
	return serviceDate > today;
}

/** `2026-09-05` → `9/5（土）`。暦日なので Date を経由せず、曜日だけ UTC で求める */
export function formatServiceDate(serviceDate: string): string {
	const [year, month, day] = serviceDate.split('-').map(Number);
	if (!year || !month || !day) return serviceDate;
	const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
	return `${month}/${day}（${weekday}）`;
}

/** `2026-08` → `2026年8月度` */
export function formatMonth(month: string): string {
	const [year, mon] = month.split('-').map(Number);
	if (!year || !mon) return month;
	return `${year}年${mon}月度`;
}

/** UTC の ISO 8601 → JST の `9/5 18:42` */
export function formatDateTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
	return `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** iso から now までに何日空いたか（JST の暦日の差）。cron の死活の「2日以上前」に使う */
export function daysBetween(iso: string, now: Date = new Date()): number {
	const from = todayInJst(new Date(iso));
	const to = todayInJst(now);
	const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
	return Math.round(ms / (24 * 60 * 60 * 1000));
}

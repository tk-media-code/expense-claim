import { parseCalendarDate } from './domain/month.js';

// scheduler.ts の引数。
//
//   --once            1回走って終わる（手で確かめるとき）
//   --at=YYYY-MM-DD   その日の 07:00（JST）として走る。--once を含む
//
// 提出アラートは 1 日と 3 日の朝にしか送らない（要件定義 7.5）ので、送る側を手で確かめるには
// 日付を与える道が要る。業務ロジック（services/alert.ts）は now を受け取る形なので、ここで差し替えるだけで済む。
// 常駐（引数なし）には効かない。走った日時は sync_state に与えた日付で残るので、確かめたあとは戻す

export type SchedulerArgs = { once: boolean; now: Date | null };

export function parseSchedulerArgs(argv: readonly string[]): SchedulerArgs {
	const at = argv.find((arg) => arg.startsWith('--at='))?.slice('--at='.length);
	if (at === undefined) return { once: argv.includes('--once'), now: null };
	if (parseCalendarDate(at) === null) {
		throw new Error(`--at は暦の上にある日を YYYY-MM-DD で指定してください: ${at}`);
	}
	return { once: true, now: new Date(`${at}T07:00:00+09:00`) };
}

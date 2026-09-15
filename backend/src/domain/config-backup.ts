// 設定データの控え（NF-11 / 01-architecture.md 8章 / 04-api.md 4.10）。
// 含めるのは駅・会場・区間・ルートだけ。実績データは含めない（消えてよいものである・N-05）。
// 読み込みは追加ではなく置き換え。控えは丸ごと1つで、部分的に混ぜると元の形に戻らない。
//
// 駅と区間は id ではなく名前で結ぶ。控えは別の DB（目的②の移行先）へ持ち込むもので、id は付け直される。
// DB を替えてもこの機能が残り、この機能そのものが移行手段になる
export type ConfigBackup = {
	version: 1;
	/** 書き出した日時。UTC の ISO 8601 */
	exportedAt: string;
	stations: { name: string }[];
	venues: { code: string; name: string; source: 'master' | 'manual' }[];
	segments: { fromStation: string; toStation: string; oneWayFare: number }[];
	routes: {
		venueCode: string;
		name: string;
		/** 並び順。区間は出発駅と到着駅の名前で指す */
		segments: { fromStation: string; toStation: string }[];
	}[];
};

export const CONFIG_BACKUP_VERSION = 1;

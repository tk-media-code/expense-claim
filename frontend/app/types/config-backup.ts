// backend/src/domain/config-backup.ts の写し（契約の写し。types/station.ts と同じ理由）
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
		segments: { fromStation: string; toStation: string }[];
	}[];
};

export type ConfigBackupCounts = {
	stations: number;
	venues: number;
	segments: number;
	routes: number;
};

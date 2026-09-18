import { CONFIG_BACKUP_VERSION, type ConfigBackup } from '../domain/config-backup.js';
import type { ConfigBackupRepository, ConfigData } from '../repositories/config-backup.js';

export type ConfigBackupCounts = {
	stations: number;
	venues: number;
	segments: number;
	routes: number;
};

// 設定データの控え（NF-11 / 04-api.md 4.10）。書き出しと読み込み。読み込みは置き換え
export function createConfigBackupService(repository: ConfigBackupRepository) {
	return {
		async exportBackup(now: Date): Promise<ConfigBackup> {
			return {
				version: CONFIG_BACKUP_VERSION,
				exportedAt: now.toISOString(),
				...(await repository.exportAll()),
			};
		},

		async importBackup(backup: ConfigData): Promise<ConfigBackupCounts> {
			await repository.replaceAll(backup);
			return {
				stations: backup.stations.length,
				venues: backup.venues.length,
				segments: backup.segments.length,
				routes: backup.routes.length,
			};
		},
	};
}

export type ConfigBackupService = ReturnType<typeof createConfigBackupService>;

// backend/src/domain/settings.ts と google-authorization.ts の写し（契約の写し。types/station.ts と同じ理由）
export type ScopeName = 'gmail.readonly' | 'gmail.send' | 'drive.file' | 'spreadsheets';

export type GoogleAuthorization = {
	authorized: boolean;
	scopes: ScopeName[];
	authorizedAt: string | null;
	missingScopes: ScopeName[];
};

export type Settings = {
	spreadsheetName: string | null;
	sheetName: string | null;
	/** YYYY-MM。一度も同期していなければ null */
	targetMonth: string | null;
	google: Pick<GoogleAuthorization, 'authorized' | 'missingScopes'>;
};

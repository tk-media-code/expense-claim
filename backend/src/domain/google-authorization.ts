// Google API の認可の状態。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// 返すのは有無・スコープ・認可日時だけ（04-api.md 4.2）。トークンは返さない（NF-05）。

/** 05-integration.md 3.3 の4つ。画面と応答では短い名前で扱う */
export const REQUIRED_SCOPES = {
	'gmail.readonly': 'https://www.googleapis.com/auth/gmail.readonly',
	'gmail.send': 'https://www.googleapis.com/auth/gmail.send',
	'drive.file': 'https://www.googleapis.com/auth/drive.file',
	spreadsheets: 'https://www.googleapis.com/auth/spreadsheets',
} as const;

export type ScopeName = keyof typeof REQUIRED_SCOPES;

export type GoogleAuthorization = {
	authorized: boolean;
	/** 保持しているスコープ（短い名前）。未認可なら空 */
	scopes: ScopeName[];
	authorizedAt: Date | null;
	/** 足りないスコープ。gmail.send は後から足したもので、古いトークンだとアラートの送信だけが失敗する（F-02） */
	missingScopes: ScopeName[];
};

/** 付与されたスコープの URL から短い名前へ。知らないスコープは落とす */
export function scopeNamesOf(urls: string[]): ScopeName[] {
	const names = (Object.keys(REQUIRED_SCOPES) as ScopeName[]).filter((name) =>
		urls.includes(REQUIRED_SCOPES[name]),
	);
	return names;
}

export function missingScopesOf(granted: ScopeName[]): ScopeName[] {
	return (Object.keys(REQUIRED_SCOPES) as ScopeName[]).filter((name) => !granted.includes(name));
}

export function authorizationOf(
	credentials: { scopes: ScopeName[]; authorizedAt: Date } | null,
): GoogleAuthorization {
	if (!credentials) {
		return {
			authorized: false,
			scopes: [],
			authorizedAt: null,
			missingScopes: missingScopesOf([]),
		};
	}
	return {
		authorized: true,
		scopes: credentials.scopes,
		authorizedAt: credentials.authorizedAt,
		missingScopes: missingScopesOf(credentials.scopes),
	};
}

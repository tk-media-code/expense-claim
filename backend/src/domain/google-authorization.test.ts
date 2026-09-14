import { describe, expect, it } from 'vitest';

import { authorizationOf, missingScopesOf, scopeNamesOf } from './google-authorization.js';

describe('google authorization', () => {
	it('スコープの URL を短い名前にし、知らないものは落とす', () => {
		expect(
			scopeNamesOf([
				'https://www.googleapis.com/auth/spreadsheets',
				'https://www.googleapis.com/auth/gmail.readonly',
				'openid',
			]),
		).toEqual(['gmail.readonly', 'spreadsheets']);
	});

	// 03-database.md 5.3。gmail.send は後から足したもので、古いトークンだと足りない
	it('足りないスコープを返す', () => {
		expect(missingScopesOf(['gmail.readonly', 'drive.file', 'spreadsheets'])).toEqual([
			'gmail.send',
		]);
		expect(missingScopesOf(['gmail.readonly', 'gmail.send', 'drive.file', 'spreadsheets'])).toEqual(
			[],
		);
	});

	it('未認可なら全部が足りない', () => {
		expect(authorizationOf(null)).toEqual({
			authorized: false,
			scopes: [],
			authorizedAt: null,
			missingScopes: ['gmail.readonly', 'gmail.send', 'drive.file', 'spreadsheets'],
		});
	});
});

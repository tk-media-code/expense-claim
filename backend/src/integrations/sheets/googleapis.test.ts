import type { OAuth2Client } from 'google-auth-library';
import type { sheets_v4 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';

import type { GoogleClientProvider } from '../google/auth.js';
import { GoogleApiFailure } from '../google/errors.js';
import { createSheetsClient } from './googleapis.js';

// Sheets API を偽物にし、叩く範囲・fields と、応答の写し方を確かめる。値は架空（要求分析の実測の形）
const config = { spreadsheetId: 'sheet-id', sheetName: '1062 甲乙' };
const provider: GoogleClientProvider = { client: () => Promise.resolve({} as OAuth2Client) };

type Fake = {
	get: ReturnType<typeof vi.fn>;
	valuesGet: ReturnType<typeof vi.fn>;
	sheets: sheets_v4.Sheets;
};

function fakeSheets(options: { get?: unknown; values?: Record<string, unknown[][]> } = {}): Fake {
	const get = vi.fn(() => Promise.resolve({ data: options.get ?? {} }));
	const valuesGet = vi.fn((params: { range: string }) =>
		Promise.resolve({ data: { values: options.values?.[params.range] } }),
	);
	const sheets = {
		spreadsheets: { get, values: { get: valuesGet } },
	} as unknown as sheets_v4.Sheets;
	return { get, valuesGet, sheets };
}

function client(fake: Fake) {
	return createSheetsClient(provider, config, () => fake.sheets);
}

describe('sheets client（読む）', () => {
	// 7.1。UNFORMATTED_VALUE で A1 を読む。表示は「2026年8月」でも生値はシリアル値
	it('readTargetMonth は A1 を UNFORMATTED_VALUE で読み、対象月度にする', async () => {
		const fake = fakeSheets({ values: { "'1062 甲乙'!A1": [[46235]] } });
		await expect(client(fake).readTargetMonth()).resolves.toBe('2026-08');
		expect(fake.valuesGet).toHaveBeenCalledWith({
			spreadsheetId: 'sheet-id',
			range: "'1062 甲乙'!A1",
			valueRenderOption: 'UNFORMATTED_VALUE',
		});
	});

	// 7.2。fields を絞り、includeGridData を付けない
	it('readStructure は保護範囲から書ける行を決め、ブック名を添える', async () => {
		const fake = fakeSheets({
			get: {
				properties: { title: '交通費精算' },
				sheets: [
					{ properties: { title: '会場', gridProperties: { rowCount: 100 } } },
					{
						properties: {
							sheetId: 7,
							title: '1062 甲乙',
							gridProperties: { rowCount: 33, columnCount: 13 },
						},
						protectedRanges: [
							{ range: { startRowIndex: 0, endRowIndex: 7 }, requestingUserCanEdit: false },
							{ range: { startRowIndex: 7, endRowIndex: 32 }, requestingUserCanEdit: true },
						],
					},
				],
			},
		});
		await expect(client(fake).readStructure()).resolves.toEqual({
			spreadsheetTitle: '交通費精算',
			firstBodyRow: 8,
			lastBodyRow: 32,
			writableRows: 25,
		});
		expect(fake.get.mock.calls[0]?.[0]).toMatchObject({ spreadsheetId: 'sheet-id' });
		expect(JSON.stringify(fake.get.mock.calls[0]?.[0])).not.toContain('includeGridData');
	});

	// 要件定義 5.5。自分のシートが見つからなければ中止
	it('自分のシートが無ければ SHEET_NOT_FOUND', async () => {
		const fake = fakeSheets({
			get: { properties: { title: 'x' }, sheets: [{ properties: { title: '会場' } }] },
		});
		await expect(client(fake).readStructure()).rejects.toMatchObject({ code: 'SHEET_NOT_FOUND' });
	});

	// 7.3。A7:M7 を読んで照合する
	it('assertHeader は A7:M7 を読み、違えば SHEET_FORMAT_CHANGED', async () => {
		const ok = fakeSheets({
			values: {
				"'1062 甲乙'!A7:M7": [
					[
						'日付',
						'目的地(会場)',
						'目的',
						'案件名(新郎/新婦)',
						'出発駅',
						'到着駅',
						'往復',
						'金額',
						'タクシー',
						'高速代/駐車場',
					],
				],
			},
		});
		await expect(client(ok).assertHeader()).resolves.toBeUndefined();
		const changed = fakeSheets({ values: { "'1062 甲乙'!A7:M7": [['日付', '会場']] } });
		await expect(client(changed).assertHeader()).rejects.toMatchObject({
			code: 'SHEET_FORMAT_CHANGED',
		});
	});

	// 7.4。B8 の入力規則が参照している範囲そのものを読む。在り処を決め打ちにしない
	it('readVenueMaster は B8 の入力規則の参照先シートの A:B を読む', async () => {
		const fake = fakeSheets({
			get: {
				sheets: [
					{
						data: [
							{
								rowData: [
									{
										values: [
											{
												dataValidation: {
													condition: {
														type: 'ONE_OF_RANGE',
														values: [{ userEnteredValue: "='会場'!$A:$A" }],
													},
												},
											},
										],
									},
								],
							},
						],
					},
				],
			},
			values: { "'会場'!A:B": [['AAA', '甲ホール'], ['BBB']] },
		});
		await expect(client(fake).readVenueMaster()).resolves.toEqual([
			{ code: 'AAA', name: '甲ホール' },
			{ code: 'BBB', name: 'BBB' },
		]);
		expect(fake.get.mock.calls[0]?.[0]).toMatchObject({
			ranges: ["'1062 甲乙'!B8"],
			includeGridData: true,
		});
	});

	// 05-integration.md 2.4。401 は認可切れ、403 / 404 は共有停止
	it.each([
		[{ code: 401 }, 'GOOGLE_UNAUTHORIZED'],
		[{ code: 403 }, 'SHEET_UNREACHABLE'],
		[{ code: 404 }, 'SHEET_UNREACHABLE'],
		[new Error("Unable to parse range: 'x'!A1"), 'SHEET_NOT_FOUND'],
	])('%o を %s に写す', async (error, code) => {
		const fake = fakeSheets();
		fake.valuesGet.mockRejectedValue(error);
		await expect(client(fake).readTargetMonth()).rejects.toMatchObject({ code });
	});

	it('認可が無ければ GOOGLE_UNAUTHORIZED', async () => {
		const noAuth: GoogleClientProvider = {
			client: () => Promise.reject(new GoogleApiFailure('unauthorized', null)),
		};
		const c = createSheetsClient(noAuth, config, () => fakeSheets().sheets);
		await expect(c.readTargetMonth()).rejects.toMatchObject({ code: 'GOOGLE_UNAUTHORIZED' });
	});

	it('提出シートが設定されていなければ SHEET_NOT_FOUND', async () => {
		const c = createSheetsClient(
			provider,
			{ spreadsheetId: '', sheetName: '' },
			() => fakeSheets().sheets,
		);
		await expect(c.readTargetMonth()).rejects.toMatchObject({ code: 'SHEET_NOT_FOUND' });
	});
});

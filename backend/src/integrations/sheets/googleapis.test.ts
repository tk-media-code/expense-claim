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
	valuesUpdate: ReturnType<typeof vi.fn>;
	batchUpdate: ReturnType<typeof vi.fn>;
	sheets: sheets_v4.Sheets;
};

function fakeSheets(options: { get?: unknown; values?: Record<string, unknown[][]> } = {}): Fake {
	const get = vi.fn(() => Promise.resolve({ data: options.get ?? {} }));
	const valuesGet = vi.fn((params: { range: string }) =>
		Promise.resolve({ data: { values: options.values?.[params.range] } }),
	);
	const valuesUpdate = vi.fn(() => Promise.resolve({ data: {} }));
	const batchUpdate = vi.fn(() => Promise.resolve({ data: {} }));
	const sheets = {
		spreadsheets: { get, batchUpdate, values: { get: valuesGet, update: valuesUpdate } },
	} as unknown as sheets_v4.Sheets;
	return { get, valuesGet, valuesUpdate, batchUpdate, sheets };
}

// 実測の形。1〜7行目は編集できず、8〜32行目に編集権がある。グリッドは 33 行
const structure = {
	properties: { title: '交通費精算' },
	sheets: [
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
};

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
			sheetTitle: '1062 甲乙',
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

	describe('sheets client（書く）', () => {
		// 8.2。1回の values.update。範囲は読んだ値（A8:M32）。USER_ENTERED
		it('writeBody は本文行の矩形を1回の values.update で送る', async () => {
			const fake = fakeSheets({ get: structure });
			await client(fake).writeBody(
				[
					{
						A: '2026/9/5',
						B: 'AAA',
						C: '婚礼案件',
						D: '〇〇様△△様',
						E: 'X鉄甲駅',
						F: 'X鉄乙駅',
						G: '往復',
						H: 640,
						I: 3200,
					},
				],
				'(9/5)\nhttps://example.test/r',
			);
			expect(fake.valuesUpdate).toHaveBeenCalledTimes(1);
			const params = fake.valuesUpdate.mock.calls[0]?.[0] as {
				range: string;
				valueInputOption: string;
				requestBody: { values: unknown[][] };
			};
			expect(params.range).toBe("'1062 甲乙'!A8:M32");
			expect(params.valueInputOption).toBe('USER_ENTERED');
			expect(params.requestBody.values).toHaveLength(25);
			expect(params.requestBody.values[0]).toEqual([
				'2026/9/5',
				'AAA',
				'婚礼案件',
				'〇〇様△△様',
				'X鉄甲駅',
				'X鉄乙駅',
				'往復',
				640,
				3200,
				'',
				'',
				'',
				'(9/5)\nhttps://example.test/r',
			]);
			expect(params.requestBody.values[24]).toEqual(Array<string>(13).fill(''));
		});

		it('書ける行数を超える行は書かない（先に挿入する）', async () => {
			const fake = fakeSheets({ get: structure });
			const rows = Array.from({ length: 26 }, () => ({
				A: null,
				B: null,
				C: null,
				D: null,
				E: 'a',
				F: 'b',
				G: '往復',
				H: 1,
				I: null,
			}));
			await expect(client(fake).writeBody(rows, '')).rejects.toMatchObject({
				code: 'WRITABLE_RANGE_UNKNOWN',
			});
			expect(fake.valuesUpdate).not.toHaveBeenCalled();
		});

		// 8.3。書ける範囲の内側（最終行の手前）に挿入する。inheritFromBefore で書式を引き継ぐ
		it('insertRows は最終行の手前に count 行を挿入する', async () => {
			const fake = fakeSheets({ get: structure });
			await client(fake).insertRows(3);
			expect(fake.batchUpdate.mock.calls[0]?.[0]).toMatchObject({
				spreadsheetId: 'sheet-id',
				requestBody: {
					requests: [
						{
							insertDimension: {
								range: { sheetId: 7, dimension: 'ROWS', startIndex: 31, endIndex: 34 },
								inheritFromBefore: true,
							},
						},
					],
				},
			});
		});

		it('書き込みの 403 は SHEET_UNREACHABLE', async () => {
			const fake = fakeSheets({ get: structure });
			fake.valuesUpdate.mockRejectedValue({ code: 403 });
			await expect(client(fake).writeBody([], '')).rejects.toMatchObject({
				code: 'SHEET_UNREACHABLE',
			});
		});
	});
});

import type { OAuth2Client } from 'google-auth-library';
import { google, type sheets_v4 } from 'googleapis';

import { AppError } from '../../domain/app-error.js';
import type { GoogleClientProvider } from '../google/auth.js';
import { toAppError } from '../google/errors.js';
import type { SheetStructure, SheetsClient, SubmissionRow, VenueMasterRow } from './client.js';
import {
	assertHeaderMatches,
	bodyRectangle,
	quoteSheetTitle,
	sheetTitleOfReference,
	targetMonthOfCell,
	venueMasterOf,
	writableRangeOf,
} from './structure.js';

export type SheetsConfig = {
	/** 書き込み先。環境変数から取り、実行時に決めない（NF-08） */
	spreadsheetId: string;
	/** 自分のシート名。他人のシートへは書かない（要件定義 5.1 原則1） */
	sheetName: string;
};

// 05-integration.md 7章（読む）と 8章（書く）を googleapis で実装する。
// 叩く呼び出しは spreadsheets.get / values.get / values.update / batchUpdate の4本（2.2）。
// tools/sheet-probe/probe.cjs の段階A-2 / gmail-probe の venue-check の手順そのまま
export function createSheetsClient(
	provider: GoogleClientProvider,
	config: SheetsConfig,
	// テストが偽物の Sheets API を差し込む。本番は googleapis の実物
	sheetsOf: (auth: OAuth2Client) => sheets_v4.Sheets = (auth) =>
		google.sheets({ version: 'v4', auth }),
): SheetsClient {
	function ensureConfigured(): void {
		if (config.spreadsheetId === '' || config.sheetName === '') {
			throw new AppError('SHEET_NOT_FOUND', { message: '提出シートが設定されていません' });
		}
	}

	async function api(): Promise<sheets_v4.Sheets> {
		ensureConfigured();
		try {
			return sheetsOf(await provider.client());
		} catch (cause) {
			throw toAppError(cause, 'SHEET_UNREACHABLE');
		}
	}

	const mine = () => quoteSheetTitle(config.sheetName);

	// 自分のシートが見つからない（範囲を解釈できない 400）は SHEET_NOT_FOUND（04-api.md 5.4）
	function rethrow(cause: unknown): never {
		if (cause instanceof AppError) throw cause;
		const message = cause instanceof Error ? cause.message : '';
		if (/Unable to parse range/i.test(message)) throw new AppError('SHEET_NOT_FOUND', { cause });
		throw toAppError(cause, 'SHEET_UNREACHABLE');
	}

	async function getValues(
		sheets: sheets_v4.Sheets,
		range: string,
		unformatted = false,
	): Promise<unknown[][]> {
		try {
			const res = await sheets.spreadsheets.values.get({
				spreadsheetId: config.spreadsheetId,
				range,
				...(unformatted ? { valueRenderOption: 'UNFORMATTED_VALUE' } : {}),
			});
			return (res.data.values ?? []) as unknown[][];
		} catch (cause) {
			rethrow(cause);
		}
	}

	async function findMySheet(sheets: sheets_v4.Sheets): Promise<{
		spreadsheetTitle: string;
		sheet: sheets_v4.Schema$Sheet;
	}> {
		let data: sheets_v4.Schema$Spreadsheet;
		try {
			// includeGridData を付けない。構造だけ見たい場面が別にある（7.3）ので、軽いほうを保つ
			({ data } = await sheets.spreadsheets.get({
				spreadsheetId: config.spreadsheetId,
				fields:
					'properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),protectedRanges(range,requestingUserCanEdit))',
			}));
		} catch (cause) {
			rethrow(cause);
		}
		const sheet = (data.sheets ?? []).find((s) => s.properties?.title === config.sheetName);
		if (!sheet) throw new AppError('SHEET_NOT_FOUND');
		return { spreadsheetTitle: data.properties?.title ?? '', sheet };
	}

	return {
		configured: config.spreadsheetId !== '' && config.sheetName !== '',

		// 7.1。A1 は他シートを参照する数式で、UNFORMATTED_VALUE で読むと日付のシリアル値が返る
		async readTargetMonth() {
			const sheets = await api();
			const values = await getValues(sheets, `${mine()}!A1`, true);
			return targetMonthOfCell(values[0]?.[0]);
		},

		// 7.2。書ける行の範囲は保護範囲とグリッドの行数で決まる。25行を決め打ちにしない
		async readStructure(): Promise<SheetStructure> {
			const sheets = await api();
			const { spreadsheetTitle, sheet } = await findMySheet(sheets);
			const rowCount = sheet.properties?.gridProperties?.rowCount ?? 0;
			const range = writableRangeOf(sheet.protectedRanges ?? [], rowCount);
			return { spreadsheetTitle, ...range };
		},

		// 7.3。7行目のヘッダーを想定の並びと照合し、違えば中止する（NF-10）
		async assertHeader() {
			const sheets = await api();
			const values = await getValues(sheets, `${mine()}!A7:M7`);
			assertHeaderMatches(values[0] ?? []);
		},

		// 7.4。在り処を決め打ちにしない。B8 の入力規則が参照している範囲そのものを読む
		async readVenueMaster(): Promise<VenueMasterRow[]> {
			const sheets = await api();
			let data: sheets_v4.Schema$Spreadsheet;
			try {
				({ data } = await sheets.spreadsheets.get({
					spreadsheetId: config.spreadsheetId,
					ranges: [`${mine()}!B8`],
					includeGridData: true,
					fields:
						'sheets(data(rowData(values(dataValidation(condition(type,values(userEnteredValue)))))))',
				}));
			} catch (cause) {
				rethrow(cause);
			}
			const condition =
				data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation?.condition;
			const reference =
				condition?.type === 'ONE_OF_RANGE' ? condition.values?.[0]?.userEnteredValue : null;
			const title = reference ? sheetTitleOfReference(reference) : null;
			if (!title)
				throw new AppError('SHEET_FORMAT_CHANGED', {
					message: '会場マスタの在り処を提出シートから読めませんでした',
				});
			// コードの列（A）だけでなく会場名（B）も要るので、参照先のシートの A:B を読む
			return venueMasterOf(await getValues(sheets, `${quoteSheetTitle(title)}!A:B`));
		},

		// 8.3。書ける範囲の内側（最終行の直前）に挿入する。挿入するとグリッドも保護範囲も伸びる（実測）。
		// 値の書き込みとは別の呼び出し。挿入だけ成功して書き込みが失敗しても、空行が増えるだけ
		async insertRows(count: number): Promise<void> {
			const sheets = await api();
			const { sheet } = await findMySheet(sheets);
			const sheetId = sheet.properties?.sheetId;
			const range = writableRangeOf(
				sheet.protectedRanges ?? [],
				sheet.properties?.gridProperties?.rowCount ?? 0,
			);
			if (sheetId === undefined || sheetId === null) throw new AppError('SHEET_NOT_FOUND');
			// 0 始まりの index。最終行（lastBodyRow）の手前に count 行
			const startIndex = range.lastBodyRow - 1;
			try {
				await sheets.spreadsheets.batchUpdate({
					spreadsheetId: config.spreadsheetId,
					requestBody: {
						requests: [
							{
								insertDimension: {
									range: { sheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + count },
									inheritFromBefore: true,
								},
							},
						],
					},
				});
			} catch (cause) {
				rethrow(cause);
			}
		},

		// 8.2。本文行の全矩形を1回の values.update で送る。USER_ENTERED で 2026/8/29 が日付として入る（実測）。
		// 行の範囲は読んだ値を使い、25行を決め打ちにしない。保護範囲（1〜7行目）には触れない
		async writeBody(rows: SubmissionRow[], receiptCell: string): Promise<void> {
			const sheets = await api();
			const structure = await this.readStructure();
			if (rows.length > structure.writableRows)
				throw new AppError('WRITABLE_RANGE_UNKNOWN', {
					message: '書ける行数を超えています。先に行を挿入してください',
				});
			const values = bodyRectangle(rows, receiptCell, structure.writableRows);
			try {
				await sheets.spreadsheets.values.update({
					spreadsheetId: config.spreadsheetId,
					range: `${mine()}!A${structure.firstBodyRow}:M${structure.lastBodyRow}`,
					valueInputOption: 'USER_ENTERED',
					requestBody: { values },
				});
			} catch (cause) {
				rethrow(cause);
			}
		},
	};
}

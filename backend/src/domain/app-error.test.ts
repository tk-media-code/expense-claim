import { describe, expect, it } from 'vitest';

import { AppError, errorCatalog, type ErrorCode } from './app-error.js';

// 04-api.md 2.5 の表と 5.4 の中止条件に出ている code に、500 の INTERNAL_ERROR を加えたもの。
// code を足すとこのテストが落ちる。設計書を直さずに足せないようにするための網である。
const expectedCodes: ErrorCode[] = [
	'BAD_REQUEST',
	'UNAUTHENTICATED',
	'NOT_ALLOWED',
	'NOT_FOUND',
	'TARGET_MONTH_CHANGED',
	'PROJECT_NO_DUPLICATED',
	'INVALID_VALUE',
	'INTERNAL_ERROR',
	'SHEET_UNREACHABLE',
	'SHEET_FORMAT_CHANGED',
	'TARGET_MONTH_UNREADABLE',
	'SHEET_NOT_FOUND',
	'WRITABLE_RANGE_UNKNOWN',
	'DRIVE_UPLOAD_FAILED',
	'GOOGLE_UNAUTHORIZED',
];

describe('errorCatalog', () => {
	it('04-api.md に出ている code をちょうど持つ', () => {
		expect(Object.keys(errorCatalog).sort()).toEqual([...expectedCodes].sort());
	});

	it('すべての code が既定の文面を持つ', () => {
		for (const code of expectedCodes) {
			expect(errorCatalog[code].message, code).not.toBe('');
		}
	});

	it('04-api.md 2.5 の表どおりの状態を持つ', () => {
		expect(errorCatalog.BAD_REQUEST.status).toBe(400);
		expect(errorCatalog.UNAUTHENTICATED.status).toBe(401);
		expect(errorCatalog.NOT_ALLOWED.status).toBe(403);
		expect(errorCatalog.NOT_FOUND.status).toBe(404);
		expect(errorCatalog.TARGET_MONTH_CHANGED.status).toBe(409);
		expect(errorCatalog.PROJECT_NO_DUPLICATED.status).toBe(409);
		expect(errorCatalog.INVALID_VALUE.status).toBe(422);
		expect(errorCatalog.INTERNAL_ERROR.status).toBe(500);
		expect(errorCatalog.SHEET_UNREACHABLE.status).toBe(502);
		expect(errorCatalog.GOOGLE_UNAUTHORIZED.status).toBe(503);
	});
});

describe('AppError', () => {
	it('code から状態が引ける', () => {
		expect(new AppError('NOT_FOUND').status).toBe(404);
		expect(new AppError('PROJECT_NO_DUPLICATED').status).toBe(409);
		expect(new AppError('SHEET_UNREACHABLE').status).toBe(502);
		expect(new AppError('GOOGLE_UNAUTHORIZED').status).toBe(503);
	});

	it('message を省くと既定の文面が入る', () => {
		expect(new AppError('GOOGLE_UNAUTHORIZED').message).toBe(
			errorCatalog.GOOGLE_UNAUTHORIZED.message,
		);
	});

	it('message を渡すと既定を上書きする', () => {
		// INVALID_VALUE は「案件番号が空」「負の運賃」「同一駅」を同じ code に載せており、
		// 既定の1文では本人が何を直せばよいか分からない（04-api.md 4.4 / 4.7）。
		const err = new AppError('INVALID_VALUE', { message: '運賃に負の値は入れられません' });
		expect(err.message).toBe('運賃に負の値は入れられません');
		expect(err.status).toBe(422);
	});

	it('Error のサブクラスで、cause が保たれる', () => {
		const cause = new Error('403 from Google');
		const err = new AppError('SHEET_UNREACHABLE', { cause });
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('AppError');
		expect(err.cause).toBe(cause);
	});
});

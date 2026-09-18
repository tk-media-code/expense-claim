import { describe, expect, it } from 'vitest';

import { classifyGoogleError, GoogleApiFailure, toAppError } from './errors.js';

describe('classifyGoogleError', () => {
	// 05-integration.md 2.4。401 / invalid_grant は認可切れ、403 / 404 は共有停止
	it.each([
		[{ status: 401 }, 'unauthorized'],
		[new Error('invalid_grant: Token has been expired or revoked.'), 'unauthorized'],
		[{ response: { status: 403 } }, 'forbidden'],
		[{ code: 404 }, 'not_found'],
		[{ status: 429 }, 'quota'],
		[new Error('socket hang up'), 'other'],
	])('%o は %s', (error, kind) => {
		expect(classifyGoogleError(error).kind).toBe(kind);
	});

	it('既に分けたものはそのまま', () => {
		const failure = new GoogleApiFailure('forbidden', 403);
		expect(classifyGoogleError(failure)).toBe(failure);
	});
});

describe('toAppError', () => {
	it('認可切れは 503 GOOGLE_UNAUTHORIZED', () => {
		expect(toAppError({ status: 401 }, 'SHEET_UNREACHABLE').code).toBe('GOOGLE_UNAUTHORIZED');
	});

	it('それ以外は相手ごとの 502', () => {
		expect(toAppError({ status: 403 }, 'SHEET_UNREACHABLE').code).toBe('SHEET_UNREACHABLE');
		expect(toAppError({ status: 404 }, 'DRIVE_UPLOAD_FAILED').code).toBe('DRIVE_UPLOAD_FAILED');
	});
});

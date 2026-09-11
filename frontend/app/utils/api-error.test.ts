import { describe, expect, it } from 'vitest';

import { ApiError, UNREACHABLE_MESSAGE, toApiError } from './api-error';

describe('toApiError', () => {
	it('04-api.md 2.5 の形の本文を、そのまま写す', () => {
		const err = toApiError(404, {
			error: { code: 'NOT_FOUND', message: '見つかりませんでした' },
		});

		expect(err).toBeInstanceOf(ApiError);
		expect(err.name).toBe('ApiError');
		expect(err.code).toBe('NOT_FOUND');
		expect(err.message).toBe('見つかりませんでした');
		expect(err.status).toBe(404);
	});

	it('API の形でない本文は UNREACHABLE にする（nginx が HTML で答えたとき）', () => {
		const err = toApiError(502, '<html><body>502 Bad Gateway</body></html>');

		expect(err.code).toBe('UNREACHABLE');
		expect(err.message).toBe(UNREACHABLE_MESSAGE);
		expect(err.status).toBe(502);
	});

	it('error を持たない JSON も UNREACHABLE にする', () => {
		const err = toApiError(404, { statusCode: 404, statusMessage: 'Cannot find any path' });

		expect(err.code).toBe('UNREACHABLE');
		expect(err.message).toBe(UNREACHABLE_MESSAGE);
	});

	it('本文が無ければ UNREACHABLE にし、状態は 0 になる（ネットワーク断）', () => {
		const cause = new TypeError('Failed to fetch');
		const err = toApiError(0, undefined, cause);

		expect(err.code).toBe('UNREACHABLE');
		expect(err.status).toBe(0);
		expect(err.cause).toBe(cause);
	});
});

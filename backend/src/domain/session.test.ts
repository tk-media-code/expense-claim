import { describe, expect, it } from 'vitest';

import { isExpired, isInvalidated, SESSION_TTL_SECONDS } from './session.js';

const issuedAt = Math.floor(Date.parse('2026-09-05T10:00:00Z') / 1000);
const session = { sub: 'sub-1', iat: issuedAt };

describe('session', () => {
	// 01-architecture.md 3.7。90日
	it('90日を過ぎると期限切れ', () => {
		expect(isExpired(session, new Date((issuedAt + SESSION_TTL_SECONDS - 1) * 1000))).toBe(false);
		expect(isExpired(session, new Date((issuedAt + SESSION_TTL_SECONDS) * 1000))).toBe(true);
	});

	// 04-api.md 4.1。発行時刻が基準時刻より前なら失効
	it('基準時刻より前に発行された Cookie は失効', () => {
		expect(isInvalidated(session, null)).toBe(false);
		expect(isInvalidated(session, new Date('2026-09-05T09:59:59Z'))).toBe(false);
		expect(isInvalidated(session, new Date('2026-09-05T10:00:01Z'))).toBe(true);
	});
});

import { describe, expect, it } from 'vitest';

import { toHalfWidthDigits } from './digits';

describe('toHalfWidthDigits', () => {
	it('全角の数字だけを半角にする', () => {
		expect(toHalfWidthDigits('２００')).toBe('200');
		expect(toHalfWidthDigits('1,２00円')).toBe('1,200円');
		expect(toHalfWidthDigits('')).toBe('');
	});
});

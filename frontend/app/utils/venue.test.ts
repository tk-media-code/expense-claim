import { describe, expect, it } from 'vitest';

import { venueLabel } from './venue';

describe('venueLabel', () => {
	it('名前があればコードを添え、名前がコードのままならコードだけにする', () => {
		expect(venueLabel({ code: 'AAA', name: '甲ホール' })).toBe('AAA 甲ホール');
		expect(venueLabel({ code: 'FFF', name: 'FFF' })).toBe('FFF');
	});
});

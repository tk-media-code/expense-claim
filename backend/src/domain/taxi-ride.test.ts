import { describe, expect, it } from 'vitest';

import type { CalendarDate } from './month.js';
import { extensionOf, receiptFileName } from './taxi-ride.js';

describe('taxi-ride', () => {
	// R-13。画像と PDF
	it('画像と PDF の拡張子を決め、それ以外は null', () => {
		expect(extensionOf('image/jpeg')).toBe('jpg');
		expect(extensionOf('APPLICATION/PDF')).toBe('pdf');
		expect(extensionOf('text/plain')).toBeNull();
	});

	// 03-database.md 5.2。日付を先頭に置けば名前順が時系列になる
	it('ファイル名は <YYYYMMDD>_<会場コード>_<連番>.<拡張子>', () => {
		expect(receiptFileName('2026-09-05' as CalendarDate, 'AAA', 1, 'jpg')).toBe(
			'20260905_AAA_1.jpg',
		);
	});
});

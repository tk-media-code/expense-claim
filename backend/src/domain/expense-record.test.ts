import { describe, expect, it } from 'vitest';

import { buildLegs, defaultsFor, totalOf } from './expense-record.js';
import type { Route, RouteLeg } from './route.js';

// 要件定義 5.6 / 03-database.md 7.3 の架空の例。会場 BBB の往路「丁駅乗換」（2区間）と復路「戊駅直通」（1区間）
function leg(sortOrder: number, from: string, to: string, fare: number): RouteLeg {
	return {
		sortOrder,
		segmentId: sortOrder,
		fromStationName: from,
		toStationName: to,
		oneWayFare: fare,
	};
}

const viaOtsu: Route = {
	id: 1,
	venueId: 1,
	name: '乙駅乗換',
	legs: [leg(1, 'X鉄甲駅', 'X鉄乙駅', 320), leg(2, 'Y鉄乙駅', 'Y鉄丙駅', 210)],
};
const viaTei: Route = {
	id: 2,
	venueId: 2,
	name: '丁駅乗換',
	legs: [leg(1, 'X鉄甲駅', 'X鉄丁駅', 380), leg(2, 'Y鉄丁駅', 'Y鉄戊駅', 210)],
};
const direct: Route = {
	id: 3,
	venueId: 2,
	name: '戊駅直通',
	legs: [leg(1, 'X鉄甲駅', 'Z鉄戊駅', 520)],
};

describe('buildLegs', () => {
	// 要件定義 5.3。同じルートなら区間ごとに1行、金額は往復額（片道 ×2）
	it('往復は往路の区間ごとに1行で、金額は片道運賃の2倍', () => {
		expect(buildLegs('round', viaOtsu.legs, viaOtsu.legs)).toEqual([
			{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
			{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
		]);
	});

	// 決定9 / 7.3 の例。復路は逆順にし、出発駅と到着駅を入れ替える。運賃は片道のまま
	it('片道は往路の区間に続けて、復路のルートを反転して並べる', () => {
		expect(buildLegs('one_way', viaTei.legs, direct.legs)).toEqual([
			{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄丁駅', amount: 380 },
			{ sortOrder: 2, fromStationName: 'Y鉄丁駅', toStationName: 'Y鉄戊駅', amount: 210 },
			{ sortOrder: 3, fromStationName: 'Z鉄戊駅', toStationName: 'X鉄甲駅', amount: 520 },
		]);
	});

	it('片道で復路が2区間なら、2区間目から先に反転して並ぶ', () => {
		expect(
			buildLegs('one_way', direct.legs, viaOtsu.legs).map(
				(l) => `${l.fromStationName}→${l.toStationName}`,
			),
		).toEqual(['X鉄甲駅→Z鉄戊駅', 'Y鉄丙駅→Y鉄乙駅', 'X鉄乙駅→X鉄甲駅']);
	});
});

describe('defaultsFor', () => {
	// 02-screens.md 4.3。ルートが1本ならそれが選択済みで開く。これが 2.2 の2手を成立させている
	it('ルートが1本なら選択済みで、往復の金額まで入って返る', () => {
		expect(defaultsFor([viaOtsu])).toEqual({
			tripType: 'round',
			outboundRouteId: 1,
			returnRouteId: 1,
			legs: [
				{ sortOrder: 1, fromStationName: 'X鉄甲駅', toStationName: 'X鉄乙駅', amount: 640 },
				{ sortOrder: 2, fromStationName: 'Y鉄乙駅', toStationName: 'Y鉄丙駅', amount: 420 },
			],
		});
	});

	// 決定21。2本以上あるときに前回のルートを既定にすることはしない
	it('ルートが2本以上なら未選択', () => {
		expect(defaultsFor([viaTei, direct])).toEqual({
			tripType: 'round',
			outboundRouteId: null,
			returnRouteId: null,
			legs: [],
		});
	});

	it('ルートが0本なら未選択で、クライアントが会場とルートへ導く', () => {
		expect(defaultsFor([]).outboundRouteId).toBeNull();
	});
});

describe('totalOf', () => {
	it('区間の金額を足す', () => {
		expect(totalOf(buildLegs('round', viaOtsu.legs, viaOtsu.legs))).toBe(1060);
		expect(totalOf([])).toBe(0);
	});
});

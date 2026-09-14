import type { APIRequestContext } from '@playwright/test';

// E2E の下ごしらえ。nginx 越しに API を叩いて、画面が扱うデータを作る。
// 値は架空で、他の実行と衝突しないよう時刻の刻印を付ける（開発用の DB を共有するため）。

export function todayInJst(now: Date = new Date()): string {
	const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
	return shifted.toISOString().slice(0, 10);
}

async function created(pending: ReturnType<APIRequestContext['post']>): Promise<number> {
	const res = await pending;
	if (res.status() !== 201)
		throw new Error(`下ごしらえに失敗: ${res.status()} ${await res.text()}`);
	return ((await res.json()) as { id: number }).id;
}

/** 会場を消す API は無い（04-api.md 7章）ので、E2E 用の会場は作り置き、あれば流用する */
export async function ensureVenue(
	request: APIRequestContext,
	code: string,
	name: string,
): Promise<number> {
	const res = await request.post('/api/venues', { data: { code, name } });
	if (res.status() === 201) return ((await res.json()) as { id: number }).id;
	const list = (await (await request.get('/api/venues')).json()) as {
		venues: { id: number; code: string }[];
	};
	const found = list.venues.find((venue) => venue.code === code);
	if (!found) throw new Error(`会場 ${code} を用意できなかった: ${res.status()}`);
	return found.id;
}

export type Fixture = {
	stamp: number;
	venueId: number;
	stationIds: number[];
	segmentId: number;
	routeId: number;
	projectId: number;
	coupleName: string;
	cleanup(): Promise<void>;
};

/** 「ルートが1本の会場」に「今日の案件」を1件。2手の経路の前提（02-screens.md 2.2） */
export async function seedRecordable(request: APIRequestContext): Promise<Fixture> {
	const stamp = Date.now();
	const venueId = await ensureVenue(request, 'E2E', 'E2E会場');
	const from = await created(request.post('/api/stations', { data: { name: `E駅${stamp}` } }));
	const to = await created(request.post('/api/stations', { data: { name: `F駅${stamp}` } }));
	const segmentId = await created(
		request.post('/api/segments', {
			data: { fromStationId: from, toStationId: to, oneWayFare: 320 },
		}),
	);
	const routeId = await created(
		request.post('/api/routes', {
			data: { venueId, name: `直通${stamp}`, segmentIds: [segmentId] },
		}),
	);
	const coupleName = `甲様乙様${stamp}`;
	const projectId = await created(
		request.post('/api/projects', {
			data: { projectNo: String(stamp), serviceDate: todayInJst(), venueCode: 'E2E', coupleName },
		}),
	);
	return {
		stamp,
		venueId,
		stationIds: [from, to],
		segmentId,
		routeId,
		projectId,
		coupleName,
		// 足した順の逆に消す。案件 → ルート → 区間 → 駅（会場は残す）
		async cleanup() {
			await request.delete(`/api/projects/${projectId}`);
			await request.delete(`/api/routes/${routeId}`);
			await request.delete(`/api/segments/${segmentId}`);
			for (const id of [from, to]) await request.delete(`/api/stations/${id}`);
		},
	};
}

import type { RouteLocationNormalizedLoaded } from 'vue-router';

/** `meta.back` が関数なら評価する。レイアウトとテストが使う。 */
export function backOf(route: RouteLocationNormalizedLoaded): string | undefined {
	const { back } = route.meta;
	if (typeof back === 'function') {
		return back(route);
	}
	return back;
}

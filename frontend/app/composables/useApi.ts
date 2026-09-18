import type { UseFetchOptions } from 'nuxt/app';

/** 画面から API を叩く入口。$fetch を直接呼ぶと、失敗がトーストに乗らず再試行も切れない。 */
export function useApi() {
	return useNuxtApp().$api;
}

/**
 * 画面を開いたときの読み込み用。useFetch に $api を差し込む（Nuxt 公式の形）。
 * 失敗は error.value に入る（ApiError は cause に残る）。トーストはフックが既に出している。
 *
 * キーは画面（コンポーネント）ごとに固有にする。useFetch の既定のキーは URL で、Nuxt 4 は同じキーの
 * データを画面をまたいで共有し、既に取れていれば新しい画面では取り直さない。会場一覧とルートの編集が
 * 同じ '/venues' を持つので、ルートを登録して一覧へ戻ってもリロードするまで反映されなかった
 * （2026-09-18 実測）。データは小さく、記録・提出は最新を前提にするので、開くたびに取る。
 */
export function useApiFetch<T>(url: string | (() => string), options?: UseFetchOptions<T>) {
	const id = useId();
	const key = typeof url === 'function' ? () => `${url()}#${id}` : `${url}#${id}`;
	return useFetch(url, { key, ...options, $fetch: useApi() });
}

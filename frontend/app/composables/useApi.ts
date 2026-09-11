import type { UseFetchOptions } from 'nuxt/app';

/** 画面から API を叩く入口。$fetch を直接呼ぶと、失敗がトーストに乗らず再試行も切れない。 */
export function useApi() {
	return useNuxtApp().$api;
}

/**
 * 画面を開いたときの読み込み用。useFetch に $api を差し込む（Nuxt 公式の形）。
 * 失敗は error.value に入る（ApiError は cause に残る）。トーストはフックが既に出している。
 */
export function useApiFetch<T>(url: string | (() => string), options?: UseFetchOptions<T>) {
	return useFetch(url, { ...options, $fetch: useApi() });
}

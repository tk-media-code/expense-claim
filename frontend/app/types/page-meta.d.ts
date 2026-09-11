import type { RouteLocationNormalizedLoaded } from 'vue-router';

// Nuxt の PageMeta を広げる。RouteMeta は PageMeta を継承しているので
// useRoute().meta にも同じ型が付く（nuxt/dist/pages/runtime/composables.d.ts）
declare module '#app' {
	interface PageMeta {
		/** アプリバーに出す画面名。ブラウザのタイトルにもなる */
		title?: string;
		/** 戻り先。無ければ戻るボタンを出さない（ホーム・ログイン）。記録画面だけ関数 */
		back?: string | ((route: RouteLocationNormalizedLoaded) => string);
		/** ホームだけ true。「案件を追加」とメニューをアプリバーに出す */
		menu?: boolean;
	}
}

export {};

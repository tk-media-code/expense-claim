// 未ログインをログイン画面へ飛ばす（02-screens.md 3.1 / 実装計画 5-6）。
// 確かめるのはアプリを開いた最初の1回だけ。以後の画面遷移では聞かない。
// 使っている途中で切れたときは、plugins/api.ts が 401 を受けてログイン画面へ送る。
export default defineNuxtRouteMiddleware(async (to) => {
	if (to.path === '/login') return;
	const authenticated = useAuthenticated();
	if (authenticated.value) return;
	try {
		await useApi()('/auth/session');
		authenticated.value = true;
	} catch {
		return navigateTo('/login');
	}
});

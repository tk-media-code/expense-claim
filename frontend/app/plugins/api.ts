import { toApiError, type ApiError } from '~/utils/api-error';

// /api を叩く $fetch の派生。画面はこれだけを使う（useApi / useApiFetch）。
// 失敗は必ず 04-api.md 2.5 の形で返るので、ここで一度だけ読み取ってトーストに出す。
// 画面ごとに出すと、出し忘れた画面が黙って失敗する。
export default defineNuxtPlugin(() => {
	// setup の中で一度だけ掴む。fetch のフックの中で useToast() を呼ぶと inject() の警告が出る。
	const toast = useToast();
	const { ui } = useAppConfig();

	const authenticated = useAuthenticated();
	const router = useRouter();

	function notify(err: ApiError) {
		// 401 はログイン画面へ（04-api.md 2.5）。トーストは出さない。行き先の画面が理由を語る
		if (err.code === 'UNAUTHENTICATED') {
			authenticated.value = false;
			if (router.currentRoute.value.path !== '/login') void navigateTo('/login');
			return;
		}
		// 503 は設定の「再認可する」へ導く（F-02）。トーストにその導線を添える
		if (err.code === 'GOOGLE_UNAUTHORIZED') {
			toast.add({
				title: err.message,
				color: 'error',
				icon: ui.icons.error,
				actions: [{ label: '設定を開く', to: '/settings', color: 'error', variant: 'solid' }],
			});
			return;
		}
		toast.add({ title: err.message, color: 'error', icon: ui.icons.error });
	}

	const api = $fetch.create({
		baseURL: '/api',
		// ofetch は GET を既定で1回だけ黙って再試行する（409・500・502・503 など）。
		// 静かに再試行して静かに失敗する経路を作らない（05-integration.md 2.5 と同じ考え方）。
		retry: false,
		// フックが throw すると、FetchError に包まれずそのまま呼び出し側へ届く。
		onRequestError({ error }) {
			const err = toApiError(0, undefined, error);
			notify(err);
			throw err;
		},
		onResponseError({ response }) {
			const err = toApiError(response.status, response._data);
			notify(err);
			throw err;
		},
	});

	return { provide: { api } };
});

/** ログイン済みかどうか。アプリを開いた最初の確認で立ち、401 を受けたら落ちる */
export function useAuthenticated() {
	return useState<boolean>('authenticated', () => false);
}

// ログインの OAuth（05-integration.md 3章）。インターフェースと実装を分ける（2.1）。
// services が見るのはこのインターフェースだけで、google-auth-library の語彙は実装の中に閉じる。

/** ID トークンから取り出した本人の情報。確かめるのは services（3.5） */
export type IdentityClaims = {
	sub: string;
	email: string | null;
	emailVerified: boolean;
	nonce: string | null;
};

export interface LoginProvider {
	/** 同意画面の URL。scope は openid email だけ（3.3）。PKCE の challenge と state・nonce を載せる（3.4） */
	authorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): string;
	/** 認可コードと verifier を ID トークンに替え、署名・iss・aud・exp を確かめて中身を返す（3.5 の手順1） */
	exchange(params: { code: string; codeVerifier: string }): Promise<IdentityClaims>;
}

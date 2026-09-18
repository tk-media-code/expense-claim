import type { OAuth2Client } from 'google-auth-library';

import type { GoogleAuthorization } from '../../domain/google-authorization.js';

// Google API の認可（05-integration.md 2.3 / 3.2 ②③）。インターフェースと実装を分ける（2.1）。
//
// services が見るのは GoogleAuthorizationClient だけで、トークンの存在を知らない（NF-05）。
// GoogleClientProvider は gmail / drive / sheets の実装が認可済みのクライアントを得るために使う。
// リフレッシュトークンは DB に暗号化して置き、アクセストークンはプロセスのメモリにだけ置く。

export interface GoogleAuthorizationClient {
	/** 認可の有無・保持スコープ・認可日時（04-api.md 4.2）。トークンは返さない */
	status(): Promise<GoogleAuthorization>;
	/** 同意画面の URL。4つのスコープ・offline・consent（3.1） */
	authorizationUrl(params: { state: string; codeChallenge: string }): string;
	/** 認可コードをリフレッシュトークンに替え、暗号化して保存する（3.2 ②） */
	complete(params: { code: string; codeVerifier: string }): Promise<void>;
}

export interface GoogleClientProvider {
	/**
	 * 認可済みのクライアント。無ければ・復号できなければ GoogleApiFailure('unauthorized')。
	 * tokens イベントで新しいリフレッシュトークンが降ってきたら DB を更新する（2.3）
	 */
	client(): Promise<OAuth2Client>;
}

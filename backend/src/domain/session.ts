// セッション。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// 署名付き Cookie の中身は sub（識別子）と iat（発行時刻）だけ（04-api.md 4.1）。
// メールアドレスを入れない（N-18）。有効期限は90日で、使うたび延びる（01-architecture.md 3.7）。
export type Session = {
	/** Google の ID トークンの sub */
	sub: string;
	/** 発行時刻。UNIX 秒 */
	iat: number;
};

/** 90日。切れる場所が悪い（屋外・移動中）ので長く取り、切る手立ては logout-all で用意する */
export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;

/** 期限（iat から90日）を過ぎたか */
export function isExpired(session: Session, now: Date): boolean {
	return session.iat + SESSION_TTL_SECONDS <= Math.floor(now.getTime() / 1000);
}

/**
 * 全端末失効（04-api.md 4.1）に当たるか。発行時刻が基準時刻より前なら弾く。
 * 期限の確認より前に置く。逆にすると、失効させた直後のリクエストが新しい iat を得て生き延びる
 */
export function isInvalidated(session: Session, sessionsValidAfter: Date | null): boolean {
	if (sessionsValidAfter === null) return false;
	return session.iat * 1000 < sessionsValidAfter.getTime();
}

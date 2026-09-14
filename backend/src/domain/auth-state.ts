// セッション失効の基準。domain はどの層にも依存しない（01-architecture.md 5.2）。
export type AuthState = {
	/** ここより前に発行された Cookie を弾く。null なら失効なし。UTC */
	sessionsValidAfter: Date | null;
};

import type { CalendarDate } from '../../domain/month.js';

// Gmail（05-integration.md 4章・5章）。インターフェースと実装を分ける（2.1）。
// 差出人アドレスも宛先も引数に無い。環境変数から取り、実装の中に閉じる（N-15 / NF-13）。
// Google の語彙はここで終わる。この先は文字列の話になる（domain/mail-parse.ts）

/** users.messages.get で読んだ1通（4.2） */
export type FetchedMail = {
	id: string;
	threadId: string | null;
	internalDate: Date | null;
	subject: string;
	/** text/plain パートのテキスト */
	plainBody: string;
	/** text/html パートを、タグを落としてテキストにしたもの */
	htmlText: string;
};

export interface GmailClient {
	/** 差出人アドレス（GMAIL_SENDER）の設定があるか。無ければ叩かず、未設定として扱う */
	readonly configured: boolean;
	/**
	 * 依頼メールの id を集める（4.1）。差出人アドレスを一次条件にし、ラベルを条件にしない（F-04）。
	 * after は前回の取り込み日の1日前。初回は null で付けない。境界が日付粒度なので広めに取り、
	 * 返ってきた id は imported_mails で弾く（二重の網）
	 */
	listRequestMailIds(after: CalendarDate | null): Promise<string[]>;
	/** 1通を読む（4.2） */
	fetch(id: string): Promise<FetchedMail>;
	/** 提出アラートを送る（5章）。宛先は環境変数で、実行時に組み立てない（NF-13）。12-1 */
	sendAlert(subject: string, body: string): Promise<void>;
}

import type { OAuth2Client } from 'google-auth-library';
import { google, type gmail_v1 } from 'googleapis';

import { formatForSheet, type CalendarDate } from '../../domain/month.js';
import type { GoogleClientProvider } from '../google/auth.js';
import { classifyGoogleError, GoogleApiFailure } from '../google/errors.js';
import type { FetchedMail, GmailClient } from './client.js';
import { decodeBody, findPart, headerOf, htmlToText } from './mime.js';

export type GmailConfig = {
	/** 依頼メールの差出人アドレス（N-15）。空なら取り込みは使えない */
	sender: string;
	/** 提出アラートの宛先（NF-13）。空なら送れない */
	alertTo: string;
};

// 05-integration.md 4章（読む）と 5章（送る）を googleapis で実装する。
// 叩く呼び出しは messages.list / messages.get / messages.send の3本（2.2）。
// tools/gmail-probe/probe.cjs の listAll と dump の手順そのまま
export function createGmailClient(
	provider: GoogleClientProvider,
	config: GmailConfig,
	// テストが偽物の Gmail API を差し込む。本番は googleapis の実物
	gmailOf: (auth: OAuth2Client) => gmail_v1.Gmail = (auth) => google.gmail({ version: 'v1', auth }),
): GmailClient {
	async function api(): Promise<gmail_v1.Gmail> {
		try {
			return gmailOf(await provider.client());
		} catch (cause) {
			throw classifyGoogleError(cause);
		}
	}

	return {
		configured: config.sender !== '',

		// 4.1。q は from: と after: だけ。ラベルを条件にしない（F-04）。宛先で判別しない（N-17）。
		// nextPageToken を追う。追わない実装は件数が増えた瞬間に静かに取りこぼす
		async listRequestMailIds(after: CalendarDate | null): Promise<string[]> {
			if (config.sender === '') {
				throw new GoogleApiFailure('other', null, {
					message: '依頼メールの差出人アドレスが設定されていません',
				});
			}
			const gmail = await api();
			const q =
				after === null
					? `from:${config.sender}`
					: `from:${config.sender} after:${formatForSheet(after)}`;
			const ids: string[] = [];
			let pageToken: string | undefined;
			try {
				do {
					const res = await gmail.users.messages.list({
						userId: 'me',
						q,
						maxResults: 100,
						pageToken,
					});
					for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
					pageToken = res.data.nextPageToken ?? undefined;
				} while (pageToken);
			} catch (cause) {
				throw classifyGoogleError(cause);
			}
			return ids;
		},

		// 4.2。format: 'full' で平文と HTML の両方を取る
		async fetch(id: string): Promise<FetchedMail> {
			const gmail = await api();
			let message: gmail_v1.Schema$Message;
			try {
				({ data: message } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' }));
			} catch (cause) {
				throw classifyGoogleError(cause);
			}
			const payload = message.payload ?? null;
			const internal = message.internalDate ? Number(message.internalDate) : Number.NaN;
			return {
				id: message.id ?? id,
				threadId: message.threadId ?? null,
				internalDate: Number.isFinite(internal) ? new Date(internal) : null,
				subject: headerOf(payload?.headers, 'subject') ?? '',
				plainBody: decodeBody(findPart(payload, 'text/plain')),
				htmlText: htmlToText(decodeBody(findPart(payload, 'text/html'))),
			};
		},

		async sendAlert(subject: string, body: string): Promise<void> {
			void subject;
			void body;
			throw new GoogleApiFailure('other', null, { message: '提出アラートの送信は 12-1 で入れる' });
		},
	};
}

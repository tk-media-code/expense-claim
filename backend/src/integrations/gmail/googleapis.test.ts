import type { OAuth2Client } from 'google-auth-library';
import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';

import type { CalendarDate } from '../../domain/month.js';
import type { GoogleClientProvider } from '../google/auth.js';
import { buildMessage, createGmailClient } from './googleapis.js';

// Gmail API を偽物にし、q の組み立て・ページの追い方・本文の読み方を確かめる。値は架空
const provider: GoogleClientProvider = { client: () => Promise.resolve({} as OAuth2Client) };
const config = { sender: 'requests@example.test', alertTo: 'me@example.test' };

type ListParams = gmail_v1.Params$Resource$Users$Messages$List;
type GetParams = gmail_v1.Params$Resource$Users$Messages$Get;

function fakeGmail(
	pages: { messages?: { id: string }[]; nextPageToken?: string }[],
	message?: gmail_v1.Schema$Message,
) {
	const list = vi.fn<(params: ListParams) => Promise<{ data: (typeof pages)[number] }>>(() =>
		Promise.resolve({ data: pages.shift() ?? {} }),
	);
	const get = vi.fn<(params: GetParams) => Promise<{ data: gmail_v1.Schema$Message }>>(() =>
		Promise.resolve({ data: message ?? {} }),
	);
	const send = vi.fn<
		(params: { userId: string; requestBody: { raw: string } }) => Promise<{ data: object }>
	>(() => Promise.resolve({ data: {} }));
	const gmail = { users: { messages: { list, get, send } } } as unknown as gmail_v1.Gmail;
	return { list, get, send, gmail };
}

describe('gmail client（読む）', () => {
	// 4.1。from: だけで足りることは確かめてある。after: は日付粒度で、初回は付けない
	it('listRequestMailIds は from: と after: で引き、nextPageToken を追う', async () => {
		const fake = fakeGmail([
			{ messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' },
			{ messages: [{ id: 'c' }] },
		]);
		const client = createGmailClient(provider, config, () => fake.gmail);
		await expect(client.listRequestMailIds('2026-09-04' as CalendarDate)).resolves.toEqual([
			'a',
			'b',
			'c',
		]);
		expect(fake.list.mock.calls[0]?.[0]).toMatchObject({
			userId: 'me',
			q: 'from:requests@example.test after:2026/9/4',
			maxResults: 100,
		});
		expect(fake.list.mock.calls[1]?.[0]).toMatchObject({ pageToken: 'p2' });
	});

	it('初回（after が null）は after: を付けない', async () => {
		const fake = fakeGmail([{ messages: [] }]);
		await createGmailClient(provider, config, () => fake.gmail).listRequestMailIds(null);
		expect(fake.list.mock.calls[0]?.[0]).toMatchObject({ q: 'from:requests@example.test' });
	});

	// 4.2。format: 'full'。平文と HTML の両方
	it('fetch は件名・平文・HTML 由来のテキスト・internalDate を返す', async () => {
		const fake = fakeGmail([], {
			id: 'a',
			threadId: 't',
			internalDate: '1788000000000',
			payload: {
				mimeType: 'multipart/alternative',
				headers: [{ name: 'Subject', value: '2026/9/5案件詳細です。' }],
				parts: [
					{ mimeType: 'text/plain', body: { data: Buffer.from('平文').toString('base64url') } },
					{
						mimeType: 'text/html',
						body: { data: Buffer.from('<p>HTML</p>').toString('base64url') },
					},
				],
			},
		});
		const client = createGmailClient(provider, config, () => fake.gmail);
		await expect(client.fetch('a')).resolves.toEqual({
			id: 'a',
			threadId: 't',
			internalDate: new Date(1788000000000),
			subject: '2026/9/5案件詳細です。',
			plainBody: '平文',
			htmlText: 'HTML',
		});
		expect(fake.get.mock.calls[0]?.[0]).toMatchObject({ userId: 'me', id: 'a', format: 'full' });
	});

	it('差出人が設定されていなければ失敗する', async () => {
		const fake = fakeGmail([]);
		const client = createGmailClient(provider, { ...config, sender: '' }, () => fake.gmail);
		await expect(client.listRequestMailIds(null)).rejects.toThrow(
			'差出人アドレスが設定されていません',
		);
		expect(fake.list).not.toHaveBeenCalled();
	});

	it('401 は unauthorized に分ける', async () => {
		const fake = fakeGmail([]);
		fake.list.mockRejectedValue({ code: 401 });
		await expect(
			createGmailClient(provider, config, () => fake.gmail).listRequestMailIds(null),
		).rejects.toMatchObject({
			kind: 'unauthorized',
		});
	});

	describe('gmail client（送る）', () => {
		// 5章。raw に base64url の RFC 2822。宛先は環境変数
		it('sendAlert は宛先を環境変数から取り、raw で送る', async () => {
			const fake = fakeGmail([]);
			await createGmailClient(provider, config, () => fake.gmail).sendAlert('件名', '本文');
			const params = fake.send.mock.calls[0]?.[0];
			expect(params?.userId).toBe('me');
			const raw = Buffer.from(params?.requestBody.raw ?? '', 'base64url').toString('utf8');
			expect(raw).toContain('To: me@example.test');
			expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('件名').toString('base64')}?=`);
			expect(raw.split('\r\n\r\n')[1]).toBe(Buffer.from('本文').toString('base64'));
		});

		it('buildMessage は UTF-8 の件名と本文を base64 にする', () => {
			const message = buildMessage('me@example.test', '提出', 'まだ出していません');
			expect(message).toContain('Content-Type: text/plain; charset="UTF-8"');
			expect(message).toContain('Content-Transfer-Encoding: base64');
		});

		it('宛先が設定されていなければ送らない', async () => {
			const fake = fakeGmail([]);
			await expect(
				createGmailClient(provider, { ...config, alertTo: '' }, () => fake.gmail).sendAlert(
					'a',
					'b',
				),
			).rejects.toThrow('宛先が設定されていません');
			expect(fake.send).not.toHaveBeenCalled();
		});
	});
});

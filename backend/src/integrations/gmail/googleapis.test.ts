import type { OAuth2Client } from 'google-auth-library';
import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';

import type { CalendarDate } from '../../domain/month.js';
import type { GoogleClientProvider } from '../google/auth.js';
import { createGmailClient } from './googleapis.js';

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
	const gmail = { users: { messages: { list, get } } } as unknown as gmail_v1.Gmail;
	return { list, get, gmail };
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
});

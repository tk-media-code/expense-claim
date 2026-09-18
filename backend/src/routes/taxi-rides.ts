import { Hono, type Context } from 'hono';

import { AppError } from '../domain/app-error.js';
import { parseCalendarDate } from '../domain/month.js';
import { RECEIPT_MAX_BYTES } from '../domain/taxi-ride.js';
import type { TaxiRidesService } from '../services/taxi-rides.js';
import { parseIdParam } from './request.js';

// 04-api.md 4.6 / 5.5。multipart/form-data は領収書のアップロードだけ（2.3）。
// 乗車と領収書を別のエンドポイントにしない。分けると、金額だけ登録されて領収書が無い状態を作れてしまう

async function readForm(c: Context): Promise<FormData> {
	try {
		return await c.req.formData();
	} catch (cause) {
		throw new AppError('BAD_REQUEST', { cause });
	}
}

export function createTaxiRidesRoute(service: TaxiRidesService) {
	return {
		// POST /api/projects/:id/taxi-rides
		projects: new Hono().post('/:id/taxi-rides', async (c) => {
			const projectId = parseIdParam(c);
			const form = await readForm(c);

			const amountRaw = form.get('amount');
			const amount =
				typeof amountRaw === 'string' && /^\d+$/.test(amountRaw.trim())
					? Number(amountRaw)
					: Number.NaN;
			if (!Number.isSafeInteger(amount) || amount < 0) {
				throw new AppError('INVALID_VALUE', { message: '金額は0以上の整数で入れてください' });
			}

			const rodeOnRaw = form.get('rodeOn');
			const rodeOn =
				typeof rodeOnRaw === 'string' && rodeOnRaw !== '' ? parseCalendarDate(rodeOnRaw) : null;
			if (typeof rodeOnRaw === 'string' && rodeOnRaw !== '' && rodeOn === null) {
				throw new AppError('INVALID_VALUE', {
					message: '乗車日は YYYY-MM-DD の形で入れてください',
				});
			}

			const receipt = form.get('receipt');
			if (!(receipt instanceof File) || receipt.size === 0) {
				throw new AppError('INVALID_VALUE', { message: '領収書のファイルを選んでください' });
			}
			if (receipt.size > RECEIPT_MAX_BYTES) {
				throw new AppError('INVALID_VALUE', {
					message: '領収書のファイルが大きすぎます（20MB まで）',
				});
			}

			const created = await service.add(projectId, {
				amount,
				rodeOn,
				file: { mimeType: receipt.type, body: receipt.stream() },
			});
			return c.json(created, 201);
		}),

		// DELETE /api/taxi-rides/:id。204。ドライブのファイル実体は消さない
		taxiRides: new Hono().delete('/:id', async (c) => {
			await service.remove(parseIdParam(c));
			return c.body(null, 204);
		}),
	};
}

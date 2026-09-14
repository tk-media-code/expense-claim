import { AppError } from '../../domain/app-error.js';

// Google API の失敗を見分ける（05-integration.md 2.4）。
// 401 / invalid_grant は認可が切れた（再認可で直る）。403 / 404 は共有が締められた・フォルダが消えた
// （アプリ側では直せない）。取り違えると導く先が違う。
export type GoogleFailureKind = 'unauthorized' | 'forbidden' | 'not_found' | 'quota' | 'other';

export class GoogleApiFailure extends Error {
	readonly kind: GoogleFailureKind;
	readonly status: number | null;

	constructor(kind: GoogleFailureKind, status: number | null, options?: ErrorOptions) {
		super(`Google API に失敗しました（${kind}${status === null ? '' : ` ${status}`}）`, options);
		this.name = 'GoogleApiFailure';
		this.kind = kind;
		this.status = status;
	}
}

function statusOf(error: unknown): number | null {
	if (typeof error !== 'object' || error === null) return null;
	const e = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
	for (const candidate of [e.status, e.response?.status, e.code]) {
		if (typeof candidate === 'number') return candidate;
	}
	return null;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** googleapis / google-auth-library が投げたものを、種類に分ける */
export function classifyGoogleError(error: unknown): GoogleApiFailure {
	if (error instanceof GoogleApiFailure) return error;
	const status = statusOf(error);
	const message = messageOf(error);
	if (status === 401 || /invalid_grant|invalid_token/i.test(message)) {
		return new GoogleApiFailure('unauthorized', status, { cause: error });
	}
	if (status === 403) return new GoogleApiFailure('forbidden', status, { cause: error });
	if (status === 404) return new GoogleApiFailure('not_found', status, { cause: error });
	if (status === 429) return new GoogleApiFailure('quota', status, { cause: error });
	return new GoogleApiFailure('other', status, { cause: error });
}

/**
 * 04-api.md 2.5 の応答へ写す。認可切れは 503 GOOGLE_UNAUTHORIZED、それ以外は相手ごとの 502。
 * 自動再試行はしない（05-integration.md 2.5）
 */
export function toAppError(
	error: unknown,
	unreachable: 'SHEET_UNREACHABLE' | 'DRIVE_UPLOAD_FAILED',
): AppError {
	const failure = classifyGoogleError(error);
	if (failure.kind === 'unauthorized')
		return new AppError('GOOGLE_UNAUTHORIZED', { cause: failure });
	return new AppError(unreachable, { cause: failure });
}

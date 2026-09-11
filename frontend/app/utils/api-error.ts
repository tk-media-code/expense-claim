// 04-api.md 2.5 の code。backend/src/domain/app-error.ts の errorCatalog と同じ並びを持つ。
// 別々の Dockerfile でビルドされ相手のソースを import する経路が無いので、契約の写しとして持つ。
// 閉じた型にするのは、導く先を分ける比較（err.code === 'GOOGLE_UNAUTHORIZED'）の
// 綴り違いをコンパイラに捕まえさせるためである。
export type ApiErrorCode =
	| 'BAD_REQUEST'
	| 'UNAUTHENTICATED'
	| 'NOT_ALLOWED'
	| 'NOT_FOUND'
	| 'TARGET_MONTH_CHANGED'
	| 'PROJECT_NO_DUPLICATED'
	| 'INVALID_VALUE'
	| 'INTERNAL_ERROR'
	| 'SHEET_UNREACHABLE'
	| 'SHEET_FORMAT_CHANGED'
	| 'TARGET_MONTH_UNREADABLE'
	| 'SHEET_NOT_FOUND'
	| 'WRITABLE_RANGE_UNKNOWN'
	| 'DRIVE_UPLOAD_FAILED'
	| 'GOOGLE_UNAUTHORIZED'
	// 応答が無い・応答が API の形でない（バックエンドが落ちて nginx が代わりに答えた、など）。
	// フロントだけの code で、バックエンドは返さない。API の失敗ではないので 04-api.md の表には載らない。
	| 'UNREACHABLE';

/** 200 に載る「知らせて続ける」（04-api.md 2.6）。中止ではないので例外にならず、データとして返る。 */
export type ApiWarning = { code: string; message: string; projectId?: number };

/** 応答が API の形でないときの文面。バックエンドの文面が無いので、これだけフロントが持つ。 */
export const UNREACHABLE_MESSAGE =
	'サーバーに接続できませんでした。しばらくしてからやり直してください';

// 「応答から読み取った失敗」である。バックエンドの AppError（throw して応答になるもの）とは
// 向きが逆なので、同じ名前にしない。
export class ApiError extends Error {
	readonly code: ApiErrorCode;
	/** HTTP の状態。応答が無ければ 0 */
	readonly status: number;

	constructor(code: ApiErrorCode, message: string, status: number, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
	}
}

type ErrorBody = { error: { code: ApiErrorCode; message: string } };

// 本文が 04-api.md 2.5 の形かどうか。zod はフロントに入れていないので手で確かめる。
// code が ApiErrorCode に含まれるかまでは見ない。知らない code が来ても message は本人が読める
// 日本語であり、UNREACHABLE に落として文面を捨てるより、そのまま出すほうがよい。
function isErrorBody(body: unknown): body is ErrorBody {
	if (typeof body !== 'object' || body === null || !('error' in body)) return false;
	const { error } = body;
	if (typeof error !== 'object' || error === null) return false;
	return (
		'code' in error &&
		typeof error.code === 'string' &&
		'message' in error &&
		typeof error.message === 'string'
	);
}

/** 応答の本文を ApiError に写す。形が違えば UNREACHABLE。 */
export function toApiError(status: number, body: unknown, cause?: unknown): ApiError {
	if (isErrorBody(body)) {
		return new ApiError(body.error.code, body.error.message, status, { cause });
	}
	return new ApiError('UNREACHABLE', UNREACHABLE_MESSAGE, status, { cause });
}

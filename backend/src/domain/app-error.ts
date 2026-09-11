// エラー応答の code・状態・既定の文面を1か所に持つ（04-api.md 2.5）。
// domain はどの層にも依存しない（01-architecture.md 5.2）ので、
// routes / services / integrations のどこからでも throw できる。
//
// code と状態を別ファイルに割らないのは、2.5 が1つの表として決めているからである。
// 割ると code を足すたびに2か所を触ることになり、表が2つに割れる。
//
// 文面に識別子を入れない（N-08 / N-18・06-error-handling.md 4.2）。
// スプレッドシートID・シート名・フォルダID・宛先アドレス・氏名は書かない。
// 本人が読んでも動けない値であり、この文面は人に見せることがある。
export const errorCatalog = {
	BAD_REQUEST: { status: 400, message: 'リクエストの形式が正しくありません' },
	UNAUTHENTICATED: { status: 401, message: 'ログインしてください' },
	NOT_ALLOWED: { status: 403, message: 'この操作は許可されていません' },
	NOT_FOUND: { status: 404, message: '見つかりませんでした' },
	TARGET_MONTH_CHANGED: {
		status: 409,
		message: '提出シートの対象月度が変わりました。確認し直してください',
	},
	PROJECT_NO_DUPLICATED: { status: 409, message: 'その案件番号は既に登録されています' },
	INVALID_VALUE: { status: 422, message: '入力した値が正しくありません' },
	INTERNAL_ERROR: { status: 500, message: '予期しないエラーが発生しました' },
	SHEET_UNREACHABLE: {
		status: 502,
		message: '提出シートに届きませんでした。共有が続いているか確かめてください',
	},
	SHEET_FORMAT_CHANGED: {
		status: 502,
		message: '提出シートの様式が変わっています。書き込みを中止しました',
	},
	TARGET_MONTH_UNREADABLE: { status: 502, message: '提出シートの対象月度を読めませんでした' },
	SHEET_NOT_FOUND: { status: 502, message: '提出シートの中に自分のシートが見つかりませんでした' },
	WRITABLE_RANGE_UNKNOWN: { status: 502, message: '書き込める行の範囲を特定できませんでした' },
	DRIVE_UPLOAD_FAILED: { status: 502, message: '領収書をドライブへ保存できませんでした' },
	GOOGLE_UNAUTHORIZED: {
		status: 503,
		message: 'Google との連携が切れています。設定から再認可してください',
	},
} as const;

export type ErrorCode = keyof typeof errorCatalog;

/** エラー応答の本文（04-api.md 2.5）。作るのは routes/error-handler.ts だけである。 */
export type ErrorBody = { error: { code: ErrorCode; message: string } };

// クラス名を ApiError にしない。このリポジトリでは「API」が Google の API を指しており
// （01-architecture.md 5.2 / 05-integration.md 2.4）、SHEET_UNREACHABLE を throw するのは
// その integrations である。ApiError では、どちらの API のエラーか読めなくなる。
export class AppError extends Error {
	readonly code: ErrorCode;

	// message は任意。既定の文面で言い切れないときだけ渡す（INVALID_VALUE など）。
	// 同じ失敗が経路ごとに違う言い方になるのを防ぐため、既定をカタログ側に置いている。
	constructor(code: ErrorCode, options?: { message?: string; cause?: unknown }) {
		super(options?.message ?? errorCatalog[code].message, { cause: options?.cause });
		this.name = 'AppError';
		this.code = code;
	}

	get status() {
		return errorCatalog[this.code].status;
	}
}

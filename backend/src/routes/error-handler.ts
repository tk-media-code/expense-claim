import type { ErrorHandler, NotFoundHandler } from 'hono';

import { AppError, type ErrorBody, errorCatalog } from '../domain/app-error.js';

// エラー応答の形を作るのはこの2つのハンドラだけである（04-api.md 2.5）。
// 文面はカタログから引く。ここで文字列を書くとカタログと二重になる。
function bodyOf(err: AppError): ErrorBody {
	return { error: { code: err.code, message: err.message } };
}

export const handleError: ErrorHandler = (err, c) => {
	if (err instanceof AppError) {
		// 4xx は意図した応答なのでログに出さない。5xx は相手の失敗か自分のバグで、
		// cause まで残さないと追えない（07-development.md 6章）。
		if (err.status >= 500) console.error(err);
		return c.json(bodyOf(err), err.status);
	}

	// ここへ来るのは想定外の例外＝バグである。
	// 元の message を本文へ出さない。中身が何か分からないものを画面へ流さない。
	console.error(err);
	return c.json(bodyOf(new AppError('INTERNAL_ERROR')), errorCatalog.INTERNAL_ERROR.status);
};

// 未定義のパスも同じ形で返す（04-api.md 2.5 の「404 資源が無い」）。
// ここだけ text/plain が残ると、クライアントは JSON parse の失敗を別経路で扱うことになる。
export const handleNotFound: NotFoundHandler = (c) =>
	c.json(bodyOf(new AppError('NOT_FOUND')), errorCatalog.NOT_FOUND.status);

// mysql2 のエラーを見分ける。Drizzle は mysql2 のエラーを DrizzleQueryError で包み、
// 元のエラーを cause に持つ（db/stations.integration.test.ts が固定した見方）。
// DB のエラー code を repositories の外へ出さない（01-architecture.md 5.2）ので、
// 見分けるのもここだけで行い、呼び出し側には AppError に写して渡す。
function causeCodeOf(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	const { cause } = error;
	if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
	return typeof cause.code === 'string' ? cause.code : null;
}

/** UNIQUE 制約に当たった（ER_DUP_ENTRY）。 */
export function isDuplicateEntry(error: unknown): boolean {
	return causeCodeOf(error) === 'ER_DUP_ENTRY';
}

/**
 * 外部キーの RESTRICT に当たった（ER_ROW_IS_REFERENCED_2）。まだ使われている行を消そうとした。
 * 03-database.md 6.2 の RESTRICT を、API は 409 として言い直す（決定22）。
 */
export function isRowReferenced(error: unknown): boolean {
	return causeCodeOf(error) === 'ER_ROW_IS_REFERENCED_2';
}

/**
 * 外部キーの参照先が無い（ER_NO_REFERENCED_ROW_2）。存在しない親を指す行を入れようとした。
 * services の先読みの後に親が消された競合で起きる。API は本文の値の問題として 422 に写す。
 */
export function isNoReferencedRow(error: unknown): boolean {
	return causeCodeOf(error) === 'ER_NO_REFERENCED_ROW_2';
}

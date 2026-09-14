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

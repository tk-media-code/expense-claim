// 会場の表示名。会場マスタは会場名の列がほぼ空で（2026-09-18 実測）、そのときはコードが名前になる
// （取り込みの仕様）。名前がコードのままなら、コードを添えると同じ文字が2つ並ぶだけなので添えない。
// 名前が入っている会場ではコードを残す。案件はメールの会場コードで会場に紐づくので、突き合わせに要る
export function venueLabel(venue: { code: string; name: string }): string {
	return venue.name === venue.code ? venue.name : `${venue.code} ${venue.name}`;
}

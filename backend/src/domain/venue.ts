// 会場。domain はどの層にも依存しない（01-architecture.md 5.2）。
//
// created_at / updated_at は持たない。障害を追うための列で、業務ロジックは見ない（03-database.md 4.3）。
// 紐づくルートまで持つのは、会場43件・ルートは会場あたり1〜数本で分ける理由が無いため
// （04-api.md 4.7）。区間の中身だけは重いので、ルート1本の取得（GET /api/routes/:id）に置く。
export type VenueSource = 'master' | 'manual';

export type VenueRoute = {
	id: number;
	name: string;
	/** 使う区間の数。乗り換え無しなら1 */
	segmentCount: number;
	/** 区間の片道運賃の合計（円）。02-screens.md 3.6 の「片道合計」 */
	oneWayTotal: number;
};

export type Venue = {
	id: number;
	/** 会場コード。3文字前後の英数字。案件はこの文字列で会場を指す（03-database.md 8章） */
	code: string;
	name: string;
	/** マスタ由来（F-13）／自分で追加（F-14）。API から受け取らない（04-api.md 7章） */
	source: VenueSource;
	/** 0本の会場は記録できない（02-screens.md 4.3）。画面はこれを目立たせる */
	routes: VenueRoute[];
};

/** venues.code は VARCHAR(16)、name は VARCHAR(255)（03-database.md 5.1）。routes の検証がこれを見る */
export const VENUE_CODE_MAX_LENGTH = 16;
export const VENUE_NAME_MAX_LENGTH = 255;

// 依頼メールから項目を取り出す規則。
//
// 実物を落として比べた結果（dump）、text/plain と text/html は同じ内容を持つが、
// 落ちるものが違う。片方だけでは足りない。
//
//   text/plain … 8本のリンクの URL が本文に並ぶ。ただし表のセル境界が空白に潰れ、
//                スタッフ2名（各自が姓と名を空白で区切る）が4語に見えてしまい、
//                誰と誰なのかを切り分けられない
//   text/html  … td の境界がタブとして残るのでスタッフを切り分けられる。
//                ただし href は本文テキストに現れない
//
// そこで、提出に要る項目とリンクは平文から、スタッフ割当だけは HTML 由来の
// テキストから採る。HTML 側には Gmail が挿入した gmail-in-cell-link 以外の
// 目印が無いため、いずれにせよ位置と見出しで読むことになる。
//
// 位置に頼る箇所（先頭4行）は、頼りきりにせず裏を取る。1行目の日付が「施行日」行の
// 日付と一致し、4行目が「〇〇様 △△様」の形であることを確かめてから、
// 2行目を会場名・3行目を会場コードとして採る。書式が変わればここが偽になり、
// 黙って別の値を拾うのではなく「取れなかった」と分かる。

const DATE = String.raw`\d{4}\/\d{1,2}\/\d{1,2}`;
const FAMILY_PAIR = /^(\S+様)[ 　\t]+(\S+様)$/;

// 案件詳細メールに載っているリンクの見出し。順番は実物の並び。
const LINK_LABELS = ['案件承諾', '出発報告', '終了報告(撮編)', '終了報告(音響)', '案件資料', 'ポータル', '不具合報告', '緊急連絡網'];

function pick(text, re) {
	const m = text.match(re);
	return m ? m[1].trim() : null;
}

function normalize(text) {
	return String(text || '').replace(/\r\n?/g, '\n');
}

// 件名から日付を取り出す。案件詳細は年入り、依頼無しは年が無い（実物で確認）。
function subjectDate(subject) {
	const kind1 = String(subject || '').match(new RegExp(`^(${DATE})案件詳細です。$`));
	if (kind1) return { text: kind1[1], hasYear: true };
	const kind2 = String(subject || '').match(/^【(\d{1,2})月(\d{1,2})日\(.\)\s*依頼無しのご連絡】$/);
	if (kind2) return { text: `${kind2[1]}月${kind2[2]}日`, hasYear: false };
	return null;
}

function extractCase(plainBody, htmlText) {
	const t = normalize(plainBody);
	const head = t.split('\n').map((l) => l.trim()).filter((l) => l !== '').slice(0, 4);

	const 施行日 = pick(t, new RegExp(`^施行日[ 　\\t]*(${DATE})`, 'm'));
	const 両家 = head[3] && FAMILY_PAIR.test(head[3]) ? head[3] : null;
	// 先頭ブロックが期待どおりかを、日付の一致とご両家名の書式の2点で裏取りする
	const headTrusted = Boolean(施行日 && head[0] === 施行日 && 両家);

	const 緊急 = t.match(/の緊急連絡先[ 　\t]*\n▶[ 　\t]*(.+?)[ 　\t]+([\d\-+() ]{9,})[ 　\t]*$/m);

	return {
		headTrusted,
		施行日,
		会場名: headTrusted ? head[1] : null,
		会場コード: headTrusted && /^[0-9A-Za-z]{1,5}$/.test(head[2]) ? head[2] : null,
		ご両家名: 両家,
		挙式: pick(t, /^挙式[ 　\t]*(.+)$/m),
		披露宴: pick(t, /^披露宴[ 　\t]*(.+)$/m),
		案件番号: pick(t, /^案件番号[ 　\t]*[:：][ 　\t]*(\d+)/m),
		緊急連絡先: 緊急 ? { 氏名: 緊急[1].trim(), 電話: 緊急[2].trim() } : null,
		撮影アイテム: extractAssignments(htmlText),
		リンク: extractLinks(t),
	};
}

// 「アイテム / スタッフ1 …」の見出し行から「案件資料」の手前までが割当表。
// 空行を落とすと アイテム名 / スタッフ行 が交互に並ぶので、2行1組で読む。
//
// 組がずれたまま返すと、別のアイテムの担当者を割り当てた結果を静かに返すことになる。
// 奇数個なら組にできていないので、推測で埋めずに空を返す。
function extractAssignments(htmlText) {
	const t = normalize(htmlText);
	const m = t.match(/^アイテム[ 　\t]+スタッフ1[^\n]*\n([\s\S]*?)\n案件資料/m);
	if (!m) return [];
	const rows = m[1].split('\n').map((l) => l.replace(/[ \t]+$/, '')).filter((l) => l.trim() !== '');
	if (rows.length === 0 || rows.length % 2 !== 0) return [];
	const items = [];
	for (let i = 0; i < rows.length; i += 2) {
		items.push({
			アイテム: rows[i].trim(),
			スタッフ: rows[i + 1].split('\t').map((s) => s.trim()).filter(Boolean),
		});
	}
	return items;
}

// 見出しの次の行に <URL> が置かれている（平文パート）
function extractLinks(t) {
	const found = {};
	for (const label of LINK_LABELS) {
		const re = new RegExp(`^${label.replace(/[()]/g, '\\$&')}[ 　\\t]*\\n<(https?://[^>\\s]+)>`, 'm');
		const url = pick(t, re);
		if (url) found[label] = url;
	}
	return found;
}

module.exports = { LINK_LABELS, subjectDate, extractCase, extractAssignments, extractLinks };

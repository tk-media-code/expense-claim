#!/usr/bin/env node
// 依頼メールを Gmail API から読めるかを実機で確かめる（Issue #19）。
//
// 要求分析の未確定事項に「Gmail の依頼メールを読めるか」が1件だけ残っていた。
// 委託元の送信先が独自ドメインへ切り替わり、案件詳細と依頼無しの2種類が
// 実際に届いたので、ここで確かめて閉じる。
//
//   labels       ラベル名からラベルIDを引けるか
//   list         ラベルで引いた集合と from: で引いた集合が一致するか
//   dump         MIME 構造と本文を out/ へ落とす。抽出方式を決める前に実物を見る段
//   parse        件名で2種類を判別し、案件詳細から項目を取り出せるか
//   venue-check  取り出した会場コードが提出シートの会場マスタに実在するか
//
// sheet-probe のような段階分けと承認は要らない。gmail.readonly しか持っておらず、
// 書き込み・削除・既読化が起こり得ないため。
//
// 出力の全文は out/ へ書く（Git 管理外）。端末には実データを伏せて出す。
// 伏せる理由と方法は mail-util.cjs の冒頭に書いてある。

const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const { getAuthClient, REPO_ROOT } = require('../sheet-probe/auth.cjs');
const U = require('./mail-util.cjs');
const E = require('./extract.cjs');

// --- 下ごしらえ -------------------------------------------------------------

function loadEnv() {
	const envFile = path.join(REPO_ROOT, '.env');
	if (!fs.existsSync(envFile)) {
		throw new Error(`.env がありません。.env.example を写して実値を入れてください: ${envFile}`);
	}
	process.loadEnvFile(envFile); // Node 20.12+ の組み込み。dotenv は要らない
}

function requireEnv(name) {
	const v = process.env[name];
	if (!v) throw new Error(`.env に ${name} が設定されていません。`);
	return v;
}

function optionalEnv(name) {
	return process.env[name] || null;
}

async function clients() {
	const auth = await getAuthClient();
	return { auth, gmail: google.gmail({ version: 'v1', auth }), sheets: google.sheets({ version: 'v4', auth }) };
}

function hr(label) {
	console.log(`\n${'='.repeat(76)}\n${label}\n${'='.repeat(76)}`);
}

// --- 件名による判別 ---------------------------------------------------------

// 要求分析 6章に書いた2種類。厳密一致と緩い一致を別々に見るのは、
// 「文書に書いた書式が実物とぴたり合うか」を確かめたいため。緩いほうだけ当たる
// なら、書式のほうを実物に合わせて直す必要がある。
const KINDS = [
	{
		kind: '案件詳細',
		strict: /^\d{4}\/\d{1,2}\/\d{1,2}案件詳細です。$/,
		loose: /案件詳細/,
	},
	{
		kind: '依頼無し',
		strict: /^【\d{1,2}月\d{1,2}日\(.\)\s*依頼無しのご連絡】$/,
		loose: /依頼無し/,
	},
];

function classify(subject) {
	const s = subject || '';
	for (const k of KINDS) {
		if (k.strict.test(s)) return { kind: k.kind, match: '厳密一致' };
	}
	for (const k of KINDS) {
		if (k.loose.test(s)) return { kind: k.kind, match: '緩い一致のみ' };
	}
	return { kind: '不明', match: '一致せず' };
}

// --- API の薄いラッパ -------------------------------------------------------

async function findLabel(gmail, name) {
	const res = await gmail.users.labels.list({ userId: 'me' });
	const labels = res.data.labels || [];
	const hit = labels.find((l) => l.name === name);
	return { labels, hit };
}

// nextPageToken を追う。今は2通しかないが、追わない実装は件数が増えた瞬間に
// 静かに取りこぼすので、最初から追っておく。
async function listAll(gmail, params, cap = 200) {
	const ids = [];
	let pageToken;
	do {
		const res = await gmail.users.messages.list({ userId: 'me', maxResults: 100, ...params, pageToken });
		for (const m of res.data.messages || []) ids.push(m.id);
		pageToken = res.data.nextPageToken;
	} while (pageToken && ids.length < cap);
	return ids;
}

const META_HEADERS = ['Subject', 'From', 'To', 'Cc', 'Date', 'Delivered-To', 'Message-Id', 'Return-Path', 'Received'];

async function getMeta(gmail, id) {
	const res = await gmail.users.messages.get({
		userId: 'me',
		id,
		format: 'metadata',
		metadataHeaders: META_HEADERS,
	});
	return res.data;
}

// --- labels -----------------------------------------------------------------

async function cmdLabels() {
	const labelName = requireEnv('GMAIL_LABEL_NAME');
	const { gmail } = await clients();
	const out = {};

	hr('1  アカウントと Gmail API の疎通');
	const profile = await gmail.users.getProfile({ userId: 'me' });
	out.profile = profile.data;
	console.log(`  アカウント        : ${U.mask('アドレス', profile.data.emailAddress)}`);
	console.log(`  メール総数        : ${profile.data.messagesTotal}`);
	console.log(`  スレッド総数      : ${profile.data.threadsTotal}`);
	console.log(`  historyId         : ${profile.data.historyId}   ← 差分取得の起点になり得る`);

	hr('2  ラベル名からラベルIDを引けるか');
	const { labels, hit } = await findLabel(gmail, labelName);
	out.labels = labels;
	console.log(`  ラベル総数        : ${labels.length}（user ${labels.filter((l) => l.type === 'user').length} / system ${labels.filter((l) => l.type === 'system').length}）`);
	if (!hit) {
		const users = labels.filter((l) => l.type === 'user').map((l) => U.mask('ラベル名', l.name));
		throw new Error(
			`.env の GMAIL_LABEL_NAME に一致するラベルがありません。\n` +
				`ユーザーラベル ${users.length} 件: ${users.join(' / ')}`,
		);
	}
	out.target = hit;
	console.log(`  対象ラベル        : ${U.mask('ラベル名', hit.name)}`);
	console.log(`  ラベルID          : ${hit.id}`);
	console.log(`  種別              : ${hit.type}   ← user なら自分で作ったラベル`);

	const detail = await gmail.users.labels.get({ userId: 'me', id: hit.id });
	out.targetDetail = detail.data;
	console.log(`  このラベルの通数  : ${detail.data.messagesTotal}（未読 ${detail.data.messagesUnread}）`);

	console.log(`\n  [OK] ラベル名からラベルIDを引けた。`);
	console.log(`\n全文を ${U.saveOut('1-labels.json', out)} に保存しました（Git 管理外）。`);
}

// --- list -------------------------------------------------------------------

async function cmdList() {
	const labelName = requireEnv('GMAIL_LABEL_NAME');
	const sender = optionalEnv('GMAIL_SENDER');
	const { gmail } = await clients();
	const out = {};

	const { hit } = await findLabel(gmail, labelName);
	if (!hit) throw new Error(`ラベルが見つかりません。先に labels を実行してください。`);
	const meAddress = (await gmail.users.getProfile({ userId: 'me' })).data.emailAddress;

	hr('1  ラベルで引く / 差出人で引く');
	const byLabel = await listAll(gmail, { labelIds: [hit.id] });
	console.log(`  ラベルID で引いた : ${byLabel.length} 通`);

	let bySender = null;
	if (sender) {
		bySender = await listAll(gmail, { q: `from:${sender}` });
		console.log(`  from: で引いた    : ${bySender.length} 通`);
		const onlyLabel = byLabel.filter((id) => !bySender.includes(id));
		const onlySender = bySender.filter((id) => !byLabel.includes(id));
		out.diff = { onlyLabel, onlySender };
		if (onlyLabel.length === 0 && onlySender.length === 0) {
			console.log(`\n  [OK] 両者は同じ集合。ラベルに頼らず差出人だけでも同じものが拾える。`);
		} else {
			console.log(`\n  ⚠ 集合が食い違う。ラベルのみ ${onlyLabel.length} 通 / 差出人のみ ${onlySender.length} 通`);
			console.log(`     ラベルはフィルタ任せなので、付いていない依頼メールが居る可能性がある。`);
		}
	} else {
		console.log(`  from: での照合    : ⚠ .env の GMAIL_SENDER が空のため省略`);
		console.log(`                      下の一覧で差出人を確かめ、.env に入れてから再実行すること`);
	}
	out.byLabel = byLabel;
	out.bySender = bySender;

	hr('2  一覧（差出人・宛先は伏せてある）');
	const all = [...new Set([...byLabel, ...(bySender || [])])];
	const metas = [];
	for (const id of all) {
		const m = await getMeta(gmail, id);
		metas.push(m);
		const h = m.payload?.headers || [];
		const subject = U.header(h, 'subject');
		const c = classify(subject);
		console.log(`\n  --- ${id} ---`);
		console.log(`  受信日時          : ${new Date(Number(m.internalDate)).toISOString()}`);
		console.log(`  件名              : ${subject}`);
		console.log(`  判別              : ${c.kind}（${c.match}）`);
		console.log(`  差出人            : ${U.maskAddressHeader(U.header(h, 'from'))}`);
		console.log(`  宛先              : ${U.maskAddressHeader(U.header(h, 'to'))}`);
		console.log(`  Delivered-To      : ${U.maskAddressHeader(U.header(h, 'delivered-to'))}`);
		// 宛先で判別できるかを見る。依頼無しのメールは自分が To に居らず Bcc で届くため、
		// to: を条件にすると片方を取りこぼす。
		const tos = U.splitAddressList(U.header(h, 'to') || '').map((a) => (a.match(/<([^>]+)>/) || [, a])[1].toLowerCase());
		console.log(`  自分が To に居るか: ${tos.includes(meAddress.toLowerCase()) ? 'はい' : 'いいえ（Bcc で届いている）'}`);
		console.log(`  ラベル            : ${(m.labelIds || []).join(', ')}`);
		console.log(`  Received の段数   : ${U.allHeaders(h, 'received').length}   ← 転送が挟まっていないかの手がかり`);
		console.log(`  threadId          : ${m.threadId}`);
		console.log(`  historyId         : ${m.historyId}`);
	}
	out.metas = metas;

	console.log(`\n全文を ${U.saveOut('2-list.json', out)} に保存しました（Git 管理外）。`);
}

// --- dump -------------------------------------------------------------------

async function cmdDump() {
	const labelName = requireEnv('GMAIL_LABEL_NAME');
	const { gmail } = await clients();

	const { hit } = await findLabel(gmail, labelName);
	if (!hit) throw new Error(`ラベルが見つかりません。先に labels を実行してください。`);
	const ids = await listAll(gmail, { labelIds: [hit.id] });

	hr(`MIME 構造（${ids.length} 通）`);
	const index = [];
	for (const id of ids) {
		const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
		const raw = await gmail.users.messages.get({ userId: 'me', id, format: 'raw' });
		const h = full.data.payload?.headers || [];
		const subject = U.header(h, 'subject');
		const c = classify(subject);

		console.log(`\n  --- ${id} / ${c.kind} ---`);
		console.log(`  件名              : ${subject}`);
		console.log(`  最上位 mimeType   : ${full.data.payload?.mimeType}`);
		console.log(`  サイズ(推定)      : ${full.data.sizeEstimate} bytes`);
		for (const p of U.mimeTree(full.data.payload)) {
			console.log(
				`    [${p.path}] ${p.mimeType}` +
					`${p.filename ? ` file=${p.filename}` : ''}` +
					` size=${p.size}${p.charset ? ` charset=${p.charset}` : ''}` +
					`${p.hasData ? '' : ' (本文データ無し)'}`,
			);
		}

		// text/plain と text/html の両方について、復号できるか・何文字になるかを見る。
		for (const mt of ['text/plain', 'text/html']) {
			const part = U.findPart(full.data.payload, mt);
			if (!part) {
				console.log(`  ${mt.padEnd(11)}     : 無し`);
				continue;
			}
			const d = U.decodeBody(part);
			console.log(`  ${mt.padEnd(11)}     : ${[...d.text].length}文字 charset=${d.charset} (${d.decodedBy})`);
			U.saveOut(`3-dump-${id}-${mt.replace('/', '-')}.txt`, d.text);
			if (mt === 'text/html') U.saveOut(`3-dump-${id}-html-as-text.txt`, U.htmlToText(d.text));
		}

		U.saveOut(`3-dump-${id}-full.json`, full.data);
		U.saveOut(`3-dump-${id}-raw.eml`, Buffer.from(raw.data.raw, 'base64url').toString('binary'));
		index.push({ id, subject, kind: c.kind, mimeTree: U.mimeTree(full.data.payload) });
	}

	console.log(`\n全文を ${path.relative(REPO_ROOT, U.OUT_DIR)}/ に保存しました（Git 管理外）。`);
	U.saveOut('3-dump-index.json', index);
}

// --- parse -----------------------------------------------------------------

// 取れたか / 取れなかったかを、実値を出さずに1行で見せる。
function field(label, value, kind = null) {
	const ok = value != null && value !== '';
	const shown = ok ? (kind ? U.mask(kind, value) : value) : '(取れず)';
	console.log(`    ${ok ? '[OK]' : '[NG]'} ${label.padEnd(12, '　')} : ${shown}`);
	return ok;
}

async function cmdParse() {
	const labelName = requireEnv('GMAIL_LABEL_NAME');
	const { gmail } = await clients();
	const { hit } = await findLabel(gmail, labelName);
	if (!hit) throw new Error('ラベルが見つかりません。先に labels を実行してください。');
	const ids = await listAll(gmail, { labelIds: [hit.id] });
	const out = { messages: [] };

	for (const id of ids) {
		const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
		const msg = res.data;
		const subject = U.header(msg.payload?.headers, 'subject');
		const c = classify(subject);
		const plain = U.findPart(msg.payload, 'text/plain');
		const html = U.findPart(msg.payload, 'text/html');
		const body = plain ? U.decodeBody(plain).text : '';
		// スタッフの切り分けだけは HTML 由来のテキストが要る。理由は extract.cjs の冒頭
		const htmlText = html ? U.htmlToText(U.decodeBody(html).text) : '';

		hr(`${c.kind}（${c.match}） / ${id}`);
		console.log(`  件名              : ${subject}`);
		console.log(`  件名から日付      : ${JSON.stringify(E.subjectDate(subject))}`);

		if (c.kind === '依頼無し') {
			// R-19。取り込まないと決めたメールから案件の項目が取れてしまうと、
			// 判別を1つ間違えた瞬間に嘘のデータが入る。取れないことを確かめておく。
			const leak = E.extractCase(body, htmlText);
			const leaked = ['施行日', '会場コード', 'ご両家名', '案件番号'].filter((k) => leak[k]);
			console.log(`  本文の文字数      : ${[...body].length}`);
			console.log(`  案件の項目が取れるか : ${leaked.length === 0 ? '取れない（期待どおり）' : `⚠ ${leaked.join(', ')} が取れてしまう`}`);
			console.log(`\n  [${leaked.length === 0 ? 'OK' : 'NG'}] R-19 件名で除ける。本文にも案件の項目は無い。`);
			out.messages.push({ id, kind: c.kind, match: c.match, subject, leaked });
			continue;
		}

		const f = E.extractCase(body, htmlText);
		console.log(`  先頭ブロックの裏取り : ${f.headTrusted ? '成立（1行目の日付＝施行日、4行目＝ご両家名の書式）' : '⚠ 不成立'}`);
		console.log(`\n  --- 提出シートへ写す項目（6.2） ---`);
		const core = [
			field('施行日', f.施行日),
			field('会場コード', f.会場コード, '会場コード'),
			field('ご両家名', f.ご両家名, 'ご両家名'),
			field('案件番号', f.案件番号, '案件番号'),
		];
		console.log(`\n  --- そのほか 6.1 の項目 ---`);
		field('会場名', f.会場名, '会場名');
		field('挙式', f.挙式, '挙式');
		field('披露宴', f.披露宴, '披露宴');
		field('緊急連絡先', f.緊急連絡先 && `${f.緊急連絡先.氏名} ${f.緊急連絡先.電話}`, '緊急連絡先');
		field('撮影アイテム', f.撮影アイテム.length ? `${f.撮影アイテム.length}件（HTML 由来。平文ではスタッフを切り分けられない）` : null);
		for (const it of f.撮影アイテム) {
			console.log(`         ・${U.mask('アイテム名', it.アイテム)} 担当 ${it.スタッフ.length}名 ${it.スタッフ.map((s) => U.mask('氏名', s)).join(' ')}`);
		}
		field('リンク', Object.keys(f.リンク).length ? `${Object.keys(f.リンク).length}/${E.LINK_LABELS.length}件` : null);
		console.log(`         取れた見出し: ${Object.keys(f.リンク).join(' / ') || '無し'}`);

		console.log(`\n  [${core.every(Boolean) ? 'OK' : 'NG'}] R-01 提出に要る4項目が取れる。`);
		out.messages.push({ id, kind: c.kind, match: c.match, subject, fields: f });
	}

	console.log(`\n全文を ${U.saveOut('4-parse.json', out)} に保存しました（Git 管理外）。`);
}

// --- venue-check ------------------------------------------------------------

// 会場マスタの在り処を決め打ちにしない。提出シートの B 列に付いている入力規則
// （ONE_OF_RANGE）が参照している範囲そのものを読む。マスタのシート名や行数が
// 変わっても追随でき、これは N-14 でアプリがやるべきことと同じ手順になる。
async function cmdVenueCheck() {
	const spreadsheetId = requireEnv('SPREADSHEET_ID');
	const mySheetName = requireEnv('MY_SHEET_NAME');
	const { sheets } = await clients();
	const out = {};

	hr('1  提出シートの B 列が参照している会場マスタを突き止める');
	const meta = await sheets.spreadsheets.get({
		spreadsheetId,
		ranges: [`'${mySheetName.replace(/'/g, "''")}'!B8`],
		includeGridData: true,
		fields: 'sheets(data(rowData(values(dataValidation))))',
	});
	const dv = meta.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
	out.dataValidation = dv;
	if (dv?.condition?.type !== 'ONE_OF_RANGE') {
		throw new Error(`B8 の入力規則が ONE_OF_RANGE ではありません: ${JSON.stringify(dv?.condition)}`);
	}
	const ref = dv.condition.values[0].userEnteredValue.replace(/^=/, '');
	console.log(`  入力規則の種類    : ${dv.condition.type}`);
	console.log(`  参照している範囲  : ${ref}`);

	hr('2  マスタを読む');
	const vals = await sheets.spreadsheets.values.get({ spreadsheetId, range: ref });
	const master = (vals.data.values || []).flat().map((v) => String(v).trim()).filter(Boolean);
	out.master = master;
	console.log(`  会場コード件数    : ${master.length}`);

	// コードが見つからなかったとき、原因を「表記ゆれ」と「会場そのものが未登録」に
	// 切り分けたい。マスタのシートを丸ごと読んで、会場名でも引けるようにしておく。
	const sheetTitle = ref.replace(/^'?([^'!]+)'?!.*$/, '$1');
	const whole = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetTitle}'` });
	const rows = whole.data.values || [];
	out.masterRows = rows;
	console.log(`  マスタの行×列    : ${rows.length} 行 × ${Math.max(...rows.map((r) => r.length))} 列`);

	hr('3  依頼メールの会場コードと突き合わせる（N-14）');
	const parsed = JSON.parse(fs.readFileSync(path.join(U.OUT_DIR, '4-parse.json'), 'utf8'));
	const codes = parsed.messages.filter((m) => m.fields?.会場コード).map((m) => m.fields.会場コード);
	if (codes.length === 0) throw new Error('4-parse.json に会場コードがありません。先に parse を実行してください。');
	const norm = (v) => String(v).trim().toUpperCase().replace(/[\s　]/g, '');
	const normMaster = new Set(master.map(norm));
	const names = parsed.messages.filter((m) => m.fields?.会場コード).map((m) => m.fields.会場名);
	out.checked = [];
	let allOk = true;
	for (const [i, code] of codes.entries()) {
		const found = master.includes(code);
		const foundNorm = normMaster.has(norm(code));
		// 会場名がマスタのどこかに載っていれば「コードの表記が違う」、
		// 載っていなければ「会場そのものが未登録」と読み分けられる。
		const name = names[i];
		const nameRow = rows.find((r) => r.some((c) => norm(c) === norm(name)));
		allOk = allOk && found;
		out.checked.push({ code, found, foundNorm, nameFoundInMaster: Boolean(nameRow), nameRow: nameRow || null });
		console.log(`  ${found ? '[OK]' : '[NG]'} ${U.mask('会場コード', code)} : マスタに ${found ? '実在する' : '存在しない'}`);
		if (!found) {
			console.log(`       表記ゆれ（前後空白・大小文字）を無視しても : ${foundNorm ? '一致する' : '一致しない'}`);
			console.log(`       会場名がマスタに載っているか              : ${nameRow ? 'ある（コードの表記違い）' : 'ない（会場そのものが未登録）'}`);
		}
	}
	console.log(`\n  [${allOk ? 'OK' : 'NG'}] ${allOk ? '依頼メールの会場コードは提出シートのマスタに実在する。' : '⚠ マスタに無いコードがある。書き込む前の照合が要る（N-14）。'}`);
	console.log(`\n全文を ${U.saveOut('5-venue-check.json', out)} に保存しました（Git 管理外）。`);
}

// --- 入口 -------------------------------------------------------------------

const COMMANDS = {
	labels: cmdLabels,
	list: cmdList,
	dump: cmdDump,
	parse: cmdParse,
	'venue-check': cmdVenueCheck,
};

async function main() {
	const cmd = process.argv[2];
	if (!cmd || !COMMANDS[cmd]) {
		console.log('使い方: node tools/gmail-probe/probe.cjs <コマンド>\n');
		for (const name of Object.keys(COMMANDS)) console.log(`  ${name}`);
		process.exit(cmd ? 1 : 0);
	}
	loadEnv();
	await COMMANDS[cmd]();
}

main().catch((err) => {
	console.error(`\n[NG] ${err.message}`);
	const e = U.describeError(err);
	if (e.status) console.error(`     ${e.status} ${e.statusText ?? ''} ${e.message}`);
	process.exit(1);
});

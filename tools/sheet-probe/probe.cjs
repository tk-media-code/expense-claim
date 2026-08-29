#!/usr/bin/env node
// 提出シートへの API アクセス可否を実機で確かめる（Issue #13）。
//
// 提出シートは委託元の所有物であり、実データが入っている（要求分析 N-04）。
// いきなり書き込まず、次の3段階に分ける。
//
//   read          段階A 実シートの読み取りのみ。無害。ここで大半の答えが出る
//   sandbox       段階B 自分のドライブへ複製し、他スタッフのシートを削って検証用にする
//   write-sandbox 段階B 複製に対して書き込み・行挿入・入力規則の挙動を試す
//   verify-live   段階C 実シートへ1セルだけ書いて即消す。権限の最終確認。都度承認を取る
//
// 出力の全文は out/ へ書く（Git 管理外）。端末には他スタッフの氏名を伏せて出す。

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { google } = require('googleapis');
const { getAuthClient, REPO_ROOT } = require('./auth.cjs');
const U = require('./sheets-util.cjs');

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

async function clients() {
	const auth = await getAuthClient();
	return {
		auth,
		sheets: google.sheets({ version: 'v4', auth }),
		drive: google.drive({ version: 'v3', auth }),
	};
}

// A1 記法のシート名。空白を含むので引用が要る。
function q(title) {
	return `'${String(title).replace(/'/g, "''")}'`;
}

// 「<社員番号> <氏名>」の形のシートは個人シート。端末には氏名を出さない。
//
// 社員番号は数字だけとは限らない。実物には P1003 / S1003 / H08 のように英字が
// 前に付くものがあり、数字始まりだけを見ると 19 枚を取りこぼす。取りこぼすと
// 端末に氏名が出るうえ、複製から他人のシートを消し損ねる。
function isPersonalSheet(title) {
	return /^[A-Za-z]{0,2}\d+\s/.test(title);
}

function maskTitle(title, mySheetName) {
	if (title === mySheetName) return `${title} ← 自分`;
	if (!isPersonalSheet(title)) return title;
	const num = title.trim().split(/\s+/)[0];
	return `${num} <他スタッフ>`;
}

// 承認を取る。readline は呼び出しごとに作らない。パイプで入力を渡したとき、
// 最初のインターフェースが先読みで残りの行まで食い潰してしまい、2回目以降が
// EOF になって固まるため。ひとつ作って使い回す。
let sharedRl = null;
function rlOnce() {
	sharedRl ||= readline.createInterface({ input: process.stdin, output: process.stdout });
	return sharedRl;
}

// --yes を付けた実行では聞かない。ユーザーが事前にすべての操作を承認した場合に使う。
const ASSUME_YES = process.argv.includes('--yes');

async function confirm(question) {
	if (ASSUME_YES) {
		console.log(`\n${question} [--yes により承認済み]`);
		return true;
	}
	const ans = (await rlOnce().question(`\n${question} [y/N] `)).trim().toLowerCase();
	return ans === 'y' || ans === 'yes';
}

function closeRl() {
	sharedRl?.close();
	sharedRl = null;
}

function hr(label) {
	console.log(`\n${'='.repeat(76)}\n${label}\n${'='.repeat(76)}`);
}

// --- 段階A 読み取りのみ -----------------------------------------------------

async function cmdRead() {
	const spreadsheetId = requireEnv('SPREADSHEET_ID');
	const mySheetName = requireEnv('MY_SHEET_NAME');
	const { sheets, drive } = await clients();
	const out = {};

	hr('段階A-1  ファイルの素性と自分の権限（Drive API）');
	const file = await drive.files.get({
		fileId: spreadsheetId,
		fields:
			'id,name,mimeType,createdTime,modifiedTime,owners(displayName,emailAddress),capabilities',
		supportsAllDrives: true,
	});
	out.file = file.data;
	const cap = file.data.capabilities || {};
	console.log(`  ファイル名        : ${file.data.name}`);
	console.log(`  所有者            : ${(file.data.owners || []).map((o) => o.emailAddress).join(', ')}`);
	console.log(`  最終更新          : ${file.data.modifiedTime}`);
	console.log(`  canEdit（編集可）  : ${cap.canEdit}`);
	console.log(`  canCopy（複製可）  : ${cap.canCopy}`);
	console.log(`  canShare          : ${cap.canShare}`);
	console.log(`  canDelete         : ${cap.canDelete}`);

	hr('段階A-2  ブックの属性と全シートの保護範囲（Sheets API）');
	const meta = await sheets.spreadsheets.get({
		spreadsheetId,
		fields:
			'properties(title,locale,timeZone,autoRecalc),' +
			'sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount)),' +
			'protectedRanges(protectedRangeId,range,description,warningOnly,requestingUserCanEdit,unprotectedRanges))',
	});
	out.meta = meta.data;
	const props = meta.data.properties || {};
	console.log(`  ブック名          : ${props.title}`);
	console.log(`  ロケール          : ${props.locale}`);
	console.log(`  タイムゾーン      : ${props.timeZone}   ← A列の日付の入り方に効く`);
	const allSheets = meta.data.sheets || [];
	console.log(`  シート数          : ${allSheets.length}（非表示 ${allSheets.filter((s) => s.properties.hidden).length}）`);

	// 自分のシート
	const mine = allSheets.find((s) => s.properties.title === mySheetName);
	if (!mine) {
		const cands = allSheets.map((s) => s.properties.title).filter(isPersonalSheet).slice(0, 5);
		throw new Error(
			`.env の MY_SHEET_NAME「${mySheetName}」に一致するシートがありません。\n` +
				`個人シートの例: ${cands.join(' / ')}`,
		);
	}

	console.log(`\n  --- 自分のシート「${mySheetName}」の保護範囲 ---`);
	const myProt = mine.protectedRanges || [];
	if (myProt.length === 0) {
		console.log('  保護範囲は設定されていません。');
	}
	for (const p of myProt) {
		console.log(
			`  ${U.gridRangeToA1(p.range)}` +
				`  編集可=${p.requestingUserCanEdit}` +
				`  警告のみ=${!!p.warningOnly}` +
				(p.description ? `  「${p.description}」` : ''),
		);
		for (const u of p.unprotectedRanges || []) {
			console.log(`      うち保護されない範囲: ${U.gridRangeToA1(u)}`);
		}
	}

	// 他スタッフのシートを自分が編集できるか。requestingUserCanEdit が答えるので
	// 実際に書き込んでみる必要がない。
	console.log('\n  --- 他スタッフのシートを自分が編集できるか ---');
	const others = allSheets.filter(
		(s) => s.properties.title !== mySheetName && isPersonalSheet(s.properties.title),
	);
	const editableOthers = [];
	let othersUnprotected = 0;
	for (const s of others) {
		const ps = s.protectedRanges || [];
		if (ps.length === 0) {
			othersUnprotected += 1;
			continue;
		}
		if (ps.some((p) => p.requestingUserCanEdit)) editableOthers.push(s.properties.title);
	}
	console.log(`  他スタッフの個人シート          : ${others.length} 枚`);
	console.log(`  保護範囲が設定されていないシート: ${othersUnprotected} 枚`);
	console.log(`  自分が編集できてしまうシート    : ${editableOthers.length} 枚`);
	if (editableOthers.length > 0) {
		console.log('  ⚠ 編集できてしまうシートがあります:');
		for (const t of editableOthers.slice(0, 10)) console.log(`      ${maskTitle(t, mySheetName)}`);
	}

	// 共通シート
	console.log('\n  --- 共通シート ---');
	const commons = allSheets.filter((s) => !isPersonalSheet(s.properties.title));
	for (const s of commons) {
		const ps = s.protectedRanges || [];
		console.log(
			`  ${s.properties.title}` +
				`（${s.properties.hidden ? '非表示' : '表示'}）` +
				` 保護範囲 ${ps.length} 件` +
				(ps.length ? ` / 編集可=${ps.map((p) => p.requestingUserCanEdit).join(',')}` : ''),
		);
	}

	hr('段階A-3  自分のシートの中身（入力規則・合計式・空き行）');
	const grid = await sheets.spreadsheets.get({
		spreadsheetId,
		ranges: [`${q(mySheetName)}!A1:M80`],
		includeGridData: true,
		fields:
			'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),merges,' +
			'data(startRow,startColumn,rowData(values(userEnteredValue,formattedValue,' +
			'dataValidation(condition(type,values(userEnteredValue)),strict,showCustomUi)))))',
	});
	out.myGrid = grid.data;
	const g = grid.data.sheets[0];
	const rows = g.data?.[0]?.rowData || [];
	console.log(`  シートの実サイズ  : ${g.properties.gridProperties.rowCount} 行 × ${g.properties.gridProperties.columnCount} 列`);

	// 1〜7行目に入っている数式（合計欄）
	console.log('\n  --- 1〜7行目のうち数式が入っているセル（触ってはいけない欄）---');
	const formulaCells = [];
	for (let r = 0; r < Math.min(7, rows.length); r += 1) {
		const vals = rows[r]?.values || [];
		for (let c = 0; c < vals.length; c += 1) {
			const f = vals[c]?.userEnteredValue?.formulaValue;
			if (!f) continue;
			const a1 = `${U.colName(c)}${r + 1}`;
			formulaCells.push({ a1, formula: f, ranges: U.extractRanges(f) });
			console.log(`  ${a1.padEnd(4)} ${f}`);
			const rs = U.extractRanges(f);
			if (rs.length) console.log(`       集計範囲 → ${rs.join(', ')}`);
		}
	}
	out.formulaCells = formulaCells;

	// 入力規則がどこまで届いているか
	console.log('\n  --- 入力規則（プルダウン等）が設定されている範囲 ---');
	const validationByCol = {};
	for (let r = 0; r < rows.length; r += 1) {
		const vals = rows[r]?.values || [];
		for (let c = 0; c < vals.length; c += 1) {
			const dv = vals[c]?.dataValidation;
			if (!dv) continue;
			const col = U.colName(c);
			validationByCol[col] ||= { from: r + 1, to: r + 1, type: dv.condition?.type, strict: dv.strict };
			validationByCol[col].to = r + 1;
		}
	}
	out.validationByCol = validationByCol;
	for (const [col, v] of Object.entries(validationByCol)) {
		console.log(`  ${col}列 : ${col}${v.from}:${col}${v.to}   種別=${v.type}  strict=${v.strict}`);
	}

	// 結合セル
	console.log('\n  --- 結合セル ---');
	const merges = g.merges || [];
	if (merges.length === 0) console.log('  なし');
	for (const m of merges.slice(0, 20)) console.log(`  ${U.gridRangeToA1(m)}`);
	if (merges.length > 20) console.log(`  ... 他 ${merges.length - 20} 件`);
	out.merges = merges;

	// 8行目以降の使用状況
	console.log('\n  --- 8行目以降の使用状況 ---');
	let lastUsed = null;
	let firstEmpty = null;
	for (let r = 7; r < rows.length; r += 1) {
		const vals = rows[r]?.values || [];
		const used = vals.some(U.cellHasValue);
		if (used) lastUsed = r + 1;
		else if (firstEmpty == null) firstEmpty = r + 1;
	}
	// 最後の使用行より後で最初に空いている行を取り直す
	if (lastUsed != null) {
		firstEmpty = lastUsed + 1;
	} else {
		firstEmpty = 8;
	}
	console.log(`  データが入っている最終行 : ${lastUsed ?? '（なし）'}`);
	console.log(`  次に空いている行         : ${firstEmpty}`);
	out.lastUsedRow = lastUsed;
	out.firstEmptyRow = firstEmpty;

	hr('段階A-4  共通シート（会場マスタ・ルール）の現在値');
	const venueSheet = commons.find((s) => /会場/.test(s.properties.title));
	if (venueSheet) {
		const v = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `${q(venueSheet.properties.title)}!A1:D100`,
		});
		out.venues = v.data.values || [];
		console.log(`  「${venueSheet.properties.title}」から ${out.venues.length} 行を取得しました。`);
	}
	const ruleSheet = commons.find((s) => /ルール|規則/.test(s.properties.title));
	if (ruleSheet) {
		const v = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `${q(ruleSheet.properties.title)}!A1:H60`,
		});
		out.rules = v.data.values || [];
		console.log(`  「${ruleSheet.properties.title}」から ${out.rules.length} 行を取得しました。`);
	}

	// B列プルダウンの選択肢を、入力規則の実体から取り出す
	const bDv = rows.find((r) => r?.values?.[1]?.dataValidation)?.values?.[1]?.dataValidation;
	if (bDv?.condition?.values) {
		const list = bDv.condition.values.map((x) => x.userEnteredValue).filter(Boolean);
		out.venueCodesFromValidation = list;
		console.log(`  B列プルダウンの選択肢 : ${list.length} 件（種別 ${bDv.condition.type}）`);
	}

	const saved = U.saveOut('A-read.json', out);
	console.log(`\n全文を ${saved} に保存しました（Git 管理外）。`);
	console.log('\n次は  node tools/sheet-probe/probe.cjs sandbox  で複製を作ります。');
}

// --- 段階B 複製を作る -------------------------------------------------------

async function cmdSandbox() {
	const spreadsheetId = requireEnv('SPREADSHEET_ID');
	const mySheetName = requireEnv('MY_SHEET_NAME');
	const { sheets, drive } = await clients();

	hr('段階B-1  提出シートを自分のドライブへ複製する');
	const name = `【検証用】expense-claim probe ${new Date().toISOString().slice(0, 10)}`;
	console.log(`  複製名: ${name}`);
	if (!(await confirm('複製を作成しますか？（実シートには一切書き込みません）'))) {
		console.log('中止しました。');
		return;
	}
	const copy = await drive.files.copy({
		fileId: spreadsheetId,
		requestBody: { name },
		fields: 'id,name,webViewLink',
		supportsAllDrives: true,
	});
	const sandboxId = copy.data.id;
	console.log(`  作成しました: ${copy.data.webViewLink}`);

	hr('段階B-2  複製から他スタッフのシートを削除する');
	console.log('  他人の個人データを手元に残さないため、自分のシートと共通シートだけ残します。');
	const meta = await sheets.spreadsheets.get({
		spreadsheetId: sandboxId,
		fields: 'sheets(properties(sheetId,title))',
	});
	const toDelete = meta.data.sheets
		.map((s) => s.properties)
		.filter((p) => p.title !== mySheetName && isPersonalSheet(p.title));
	console.log(`  削除対象: ${toDelete.length} 枚 / 残す: ${meta.data.sheets.length - toDelete.length} 枚`);
	if (toDelete.length > 0) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: sandboxId,
			requestBody: {
				requests: toDelete.map((p) => ({ deleteSheet: { sheetId: p.sheetId } })),
			},
		});
		console.log('  削除しました。');
	}

	const after = await sheets.spreadsheets.get({
		spreadsheetId: sandboxId,
		fields: 'sheets(properties(title))',
	});
	console.log('  残ったシート:');
	for (const s of after.data.sheets) console.log(`      ${s.properties.title}`);

	console.log(`\n.env に次の行を書いてください:\n\n  SANDBOX_SPREADSHEET_ID=${sandboxId}\n`);
	console.log('次は  node tools/sheet-probe/probe.cjs write-sandbox  です。');
}

// --- 段階B 複製に書き込む ---------------------------------------------------

async function cmdWriteSandbox() {
	const sandboxId = requireEnv('SANDBOX_SPREADSHEET_ID');
	const mySheetName = requireEnv('MY_SHEET_NAME');
	const { sheets } = await clients();
	const results = {};
	const S = q(mySheetName);

	// 現況を掴む。段階A で分かったとおり、合計式は sum(H8:H) の開いた範囲で、
	// 編集できるのは 8〜32行、グリッドは 33 行しかない。
	const meta = await sheets.spreadsheets.get({
		spreadsheetId: sandboxId,
		fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),protectedRanges(range,requestingUserCanEdit))',
	});
	const target = meta.data.sheets.find((s) => s.properties.title === mySheetName);
	const sheetId = target.properties.sheetId;
	const rowCount = target.properties.gridProperties.rowCount;
	console.log(`  グリッド: ${rowCount} 行 × ${target.properties.gridProperties.columnCount} 列`);
	console.log('  保護範囲: ' + (target.protectedRanges || []).map((p) => `${U.gridRangeToA1(p.range)}(編集可=${!!p.requestingUserCanEdit})`).join(' / '));
	results.before = { rowCount, protectedRanges: target.protectedRanges };

	const SUMS = ['H4', 'I4', 'J4', 'K4', 'L4'];
	const readSums = async () => {
		const res = await sheets.spreadsheets.values.batchGet({
			spreadsheetId: sandboxId,
			ranges: SUMS.map((a) => `${S}!${a}`),
			valueRenderOption: 'UNFORMATTED_VALUE',
		});
		return Object.fromEntries(SUMS.map((a, i) => [a, res.data.valueRanges[i]?.values?.[0]?.[0] ?? '']));
	};
	const put = (range, values, opt = 'USER_ENTERED') =>
		sheets.spreadsheets.values.update({
			spreadsheetId: sandboxId,
			range: `${S}!${range}`,
			valueInputOption: opt,
			requestBody: { values },
		});
	const get = (range, render = 'UNFORMATTED_VALUE') =>
		sheets.spreadsheets.values
			.get({ spreadsheetId: sandboxId, range: `${S}!${range}`, valueRenderOption: render })
			.then((r) => r.data.values);

	hr('段階B-a  日付は日付として入るか（ロケール ja_JP / Asia/Tokyo）');
	const d = new Date();
	const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
	await put('A8', [[dateStr]]);
	const aRaw = (await get('A8'))?.[0]?.[0];
	const aFmt = (await get('A8', 'FORMATTED_VALUE'))?.[0]?.[0];
	results.dateWrite = { input: dateStr, raw: aRaw, formatted: aFmt, storedAsDate: typeof aRaw === 'number' };
	console.log(`  "${dateStr}" を USER_ENTERED で書いた → 生値 ${JSON.stringify(aRaw)}（${typeof aRaw}） 表示 ${JSON.stringify(aFmt)}`);
	console.log(`  日付として入ったか: ${typeof aRaw === 'number' ? 'はい（シリアル値）' : 'いいえ（文字列のまま）'}`);

	hr('段階B-b  入力規則は API 経由で効くか');
	const checks = [
		{ cell: 'B8', value: 'ZZZ存在しない会場', label: 'B列 会場（ONE_OF_RANGE・strict なし）' },
		{ cell: 'C8', value: '存在しない目的', label: 'C列 目的（ONE_OF_LIST・strict なし）' },
		{ cell: 'G8', value: '斜め', label: 'G列 往復（ONE_OF_LIST・strict なし）' },
		{ cell: 'H8', value: -500, label: 'H列 金額（NUMBER_BETWEEN・strict=true）に負の数' },
		{ cell: 'I8', value: 'これは数値ではない', label: 'I列 タクシー（NUMBER_BETWEEN・strict=true）に文字列' },
	];
	results.validation = [];
	for (const c of checks) {
		let row;
		try {
			await put(c.cell, [[c.value]]);
			const back = (await get(c.cell))?.[0]?.[0];
			const accepted = String(back) === String(c.value);
			row = { ...c, readBack: back, accepted, error: null };
			console.log(`  ${c.label}`);
			console.log(`      → ${JSON.stringify(back)}  ${accepted ? '素通りした（規則は効かない）' : '値が変わった'}`);
		} catch (err) {
			row = { ...c, readBack: null, accepted: false, error: U.describeError(err) };
			console.log(`  ${c.label}`);
			console.log(`      → 拒否された: ${row.error.status} ${row.error.message}`);
		}
		results.validation.push(row);
	}

	hr('段階B-c  領収書欄（M8:M32 の結合セル）へ書く');
	results.receipt = {};
	try {
		await put('M8', [['https://drive.google.com/file/d/EXAMPLE1/view']]);
		results.receipt.anchor = { ok: true, readBack: (await get('M8', 'FORMATTED_VALUE'))?.[0]?.[0] };
		console.log(`  結合の左上 M8 へ → 書けた: ${results.receipt.anchor.readBack}`);
	} catch (err) {
		results.receipt.anchor = { ok: false, error: U.describeError(err) };
		console.log(`  結合の左上 M8 へ → 書けない: ${JSON.stringify(results.receipt.anchor.error)}`);
	}
	try {
		await put('M9', [['https://drive.google.com/file/d/EXAMPLE2/view']]);
		const m8 = (await get('M8', 'FORMATTED_VALUE'))?.[0]?.[0];
		results.receipt.inner = { ok: true, m8After: m8 };
		console.log(`  結合の内側 M9 へ → 書けた。M8 の表示は ${JSON.stringify(m8)}`);
		console.log('  ⚠ 結合セルなので行ごとに書き分けられない。1か月で1枠しかない');
	} catch (err) {
		results.receipt.inner = { ok: false, error: U.describeError(err) };
		console.log(`  結合の内側 M9 へ → 拒否: ${results.receipt.inner.error.status} ${results.receipt.inner.error.message}`);
	}

	hr('段階B-d  保護範囲の外だがグリッド内（33行目）に書くと合計に入るか');
	const before33 = await readSums();
	await put(`H${rowCount}`, [[7777]]);
	const after33 = await readSums();
	results.row33 = { row: rowCount, before: before33, after: after33 };
	console.log(`  H${rowCount} に 7777 を書く前: ${JSON.stringify(before33)}`);
	console.log(`  書いた後                   : ${JSON.stringify(after33)}`);
	console.log(`  合計に入ったか: ${before33.H4 !== after33.H4 ? 'はい（sum(H8:H) は開いた範囲）' : 'いいえ'}`);

	hr('段階B-e  グリッドの外（34行目以降）に書けるか');
	const beyond = rowCount + 1;
	try {
		await put(`H${beyond}`, [[8888]]);
		const afterBeyond = await sheets.spreadsheets.get({
			spreadsheetId: sandboxId,
			fields: 'sheets(properties(title,gridProperties(rowCount)))',
		});
		const nowRows = afterBeyond.data.sheets.find((s) => s.properties.title === mySheetName).properties.gridProperties.rowCount;
		results.beyondGrid = { ok: true, requestedRow: beyond, rowCountAfter: nowRows, sums: await readSums() };
		console.log(`  H${beyond} へ書けた。グリッドは ${rowCount} → ${nowRows} 行に伸びた`);
		console.log(`  合計欄: ${JSON.stringify(results.beyondGrid.sums)}`);
	} catch (err) {
		results.beyondGrid = { ok: false, requestedRow: beyond, error: U.describeError(err) };
		console.log(`  H${beyond} へは書けない: ${results.beyondGrid.error.status} ${results.beyondGrid.error.message}`);
	}

	hr('段階B-f  行を挿入すると保護範囲は伸びるか');
	const insertAt = 20; // 8〜32行の内側
	console.log(`  ${insertAt} 行目に1行挿入します（編集できる範囲の内側）。`);
	await sheets.spreadsheets.batchUpdate({
		spreadsheetId: sandboxId,
		requestBody: {
			requests: [{ insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: insertAt - 1, endIndex: insertAt }, inheritFromBefore: true } }],
		},
	});
	const afterIns = await sheets.spreadsheets.get({
		spreadsheetId: sandboxId,
		fields: 'sheets(properties(title,gridProperties(rowCount)),protectedRanges(range,requestingUserCanEdit))',
	});
	const t2 = afterIns.data.sheets.find((s) => s.properties.title === mySheetName);
	results.afterInsert = { rowCount: t2.properties.gridProperties.rowCount, protectedRanges: t2.protectedRanges };
	console.log(`  グリッド: ${t2.properties.gridProperties.rowCount} 行`);
	console.log('  保護範囲: ' + (t2.protectedRanges || []).map((p) => `${U.gridRangeToA1(p.range)}(編集可=${!!p.requestingUserCanEdit})`).join(' / '));
	const beforeEnd = (target.protectedRanges || []).find((p) => (p.range.startRowIndex ?? 0) === 7)?.range.endRowIndex;
	const afterEnd = (t2.protectedRanges || []).find((p) => (p.range.startRowIndex ?? 0) === 7)?.range.endRowIndex;
	console.log(`  編集できる範囲の終端: ${beforeEnd} → ${afterEnd}  ${afterEnd > beforeEnd ? '伸びた' : '伸びていない'}`);

	hr('段階B-g  乗り換えありの案件を2行へ展開する（R-08）');
	await put('A10:I11', [
		[dateStr, 'AKG', '婚礼案件', '検証様検証様', '自宅最寄駅', '乗換駅', '往復', 300, 0],
		[dateStr, 'AKG', '婚礼案件', '検証様検証様', '乗換駅', '会場最寄駅', '往復', 500, 0],
	]);
	results.multiLeg = await get('A10:I11', 'FORMATTED_VALUE');
	console.log(`  2行書いて読み戻し: ${JSON.stringify(results.multiLeg)}`);
	results.finalSums = await readSums();
	console.log(`  最終的な合計欄: ${JSON.stringify(results.finalSums)}`);

	const saved = U.saveOut('B-write-sandbox.json', results);
	console.log(`\n全文を ${saved} に保存しました（Git 管理外）。`);
	console.log('\n次は  node tools/sheet-probe/probe.cjs verify-live  です（実シート・都度承認）。');
}

// --- 段階C 実シートで権限を確かめる -----------------------------------------

async function cmdVerifyLive() {
	const spreadsheetId = requireEnv('SPREADSHEET_ID');
	const mySheetName = requireEnv('MY_SHEET_NAME');
	const { sheets } = await clients();
	const results = {};
	const S = q(mySheetName);

	hr('段階C-0  自分のシートの現在値を退避する（数式込み）');
	const snapshot = await sheets.spreadsheets.values.get({
		spreadsheetId,
		range: `${S}!A1:M100`,
		valueRenderOption: 'FORMULA',
	});
	const snapFile = U.saveOut(`C-snapshot-${Date.now()}.json`, snapshot.data);
	console.log(`  ${snapFile} に保存しました。何かあればここから戻せます。`);

	// 空きセルを探す
	const grid = await sheets.spreadsheets.get({
		spreadsheetId,
		ranges: [`${S}!A1:M100`],
		includeGridData: true,
		fields: 'sheets(data(rowData(values(userEnteredValue))))',
	});
	const rows = grid.data.sheets[0].data?.[0]?.rowData || [];
	let lastUsed = 7;
	for (let r = 7; r < rows.length; r += 1) {
		if ((rows[r]?.values || []).some(U.cellHasValue)) lastUsed = r + 1;
	}
	const targetRow = lastUsed + 1;
	// 備考列（L）は自由入力で数式も入力規則も無い。最も無害な書き込み先
	const targetCell = `L${targetRow}`;

	hr('段階C-1  本文行への書き込みと即時削除');
	console.log(`  対象セル: ${mySheetName}!${targetCell}`);
	console.log(`  現在の値: ${JSON.stringify(rows[targetRow - 1]?.values?.[11]?.userEnteredValue ?? null)}（空であることを確認）`);
	if (!(await confirm(`${targetCell} に目印を書いて、すぐ消します。実行しますか？`))) {
		console.log('中止しました。');
		return;
	}
	const marker = `APIテスト ${new Date().toISOString()}`;
	await sheets.spreadsheets.values.update({
		spreadsheetId,
		range: `${S}!${targetCell}`,
		valueInputOption: 'RAW',
		requestBody: { values: [[marker]] },
	});
	const wrote = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${S}!${targetCell}` });
	console.log(`  書き込み後: ${JSON.stringify(wrote.data.values?.[0]?.[0])}`);
	await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${S}!${targetCell}` });
	const cleared = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${S}!${targetCell}` });
	const isEmpty = !cleared.data.values;
	console.log(`  削除後  : ${isEmpty ? '空に戻りました' : JSON.stringify(cleared.data.values)}`);
	results.bodyWrite = { cell: targetCell, wrote: wrote.data.values?.[0]?.[0], clearedToEmpty: isEmpty };

	hr('段階C-2  保護範囲（1〜7行目）への書き込みが拒否されるか');
	// 1〜7行目のうち空のセルを探す。万一書けてしまっても消すだけで済むため
	let protectedCell = null;
	for (let r = 0; r < Math.min(7, rows.length) && !protectedCell; r += 1) {
		const vals = rows[r]?.values || [];
		for (let c = 0; c < 13; c += 1) {
			if (!U.cellHasValue(vals[c])) {
				protectedCell = `${U.colName(c)}${r + 1}`;
				break;
			}
		}
	}
	if (!protectedCell) {
		console.log('  1〜7行目に空のセルが見つかりませんでした。この確認は飛ばします。');
	} else {
		console.log(`  対象セル: ${mySheetName}!${protectedCell}（空であることを確認済み）`);
		if (await confirm(`${protectedCell} への書き込みを試します。403 が返る想定です。実行しますか？`)) {
			try {
				await sheets.spreadsheets.values.update({
					spreadsheetId,
					range: `${S}!${protectedCell}`,
					valueInputOption: 'RAW',
					requestBody: { values: [['x']] },
				});
				console.log('  ⚠ 書けてしまいました。保護されていません。すぐ消します。');
				await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${S}!${protectedCell}` });
				results.protectedWrite = { cell: protectedCell, rejected: false };
			} catch (err) {
				const e = U.describeError(err);
				console.log(`  拒否されました（想定どおり）: ${e.status} ${e.statusText}`);
				console.log(`  メッセージ: ${e.message}`);
				results.protectedWrite = { cell: protectedCell, rejected: true, error: e };
			}
		}
	}

	hr('段階C-3  行を増やせるか（挿入 → 確認 → 削除して原状復帰）');
	// 使えるのは 8〜32行の 25 行しかない。1案件が乗り換えで2行になるため、
	// 行を増やせるかどうかは運用が回るかに直結する。複製では自分が所有者に
	// なってしまい権限の証明にならないので、ここだけは実シートで確かめる。
	const beforeStruct = await sheets.spreadsheets.get({
		spreadsheetId,
		fields: 'sheets(properties(sheetId,title,gridProperties(rowCount)),protectedRanges(protectedRangeId,range,requestingUserCanEdit))',
	});
	const meSheet = beforeStruct.data.sheets.find((s) => s.properties.title === mySheetName);
	const sheetId = meSheet.properties.sheetId;
	const rowsBefore = meSheet.properties.gridProperties.rowCount;
	const bodyBefore = (meSheet.protectedRanges || []).find((p) => (p.range.startRowIndex ?? 0) === 7);
	console.log(`  現在: グリッド ${rowsBefore} 行 / 編集できる範囲 ${U.gridRangeToA1(bodyBefore?.range)}`);

	const insertAt = 20; // 8〜32行の内側
	if (await confirm(`${insertAt} 行目に1行挿入し、確認したうえで削除して元に戻します。実行しますか？`)) {
		let inserted = false;
		try {
			await sheets.spreadsheets.batchUpdate({
				spreadsheetId,
				requestBody: {
					requests: [{ insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: insertAt - 1, endIndex: insertAt }, inheritFromBefore: true } }],
				},
			});
			inserted = true;
			const afterStruct = await sheets.spreadsheets.get({
				spreadsheetId,
				fields: 'sheets(properties(title,gridProperties(rowCount)),protectedRanges(range,requestingUserCanEdit))',
			});
			const me2 = afterStruct.data.sheets.find((s) => s.properties.title === mySheetName);
			const bodyAfter = (me2.protectedRanges || []).find((p) => (p.range.startRowIndex ?? 0) === 7);
			console.log(`  挿入できました。グリッド ${rowsBefore} → ${me2.properties.gridProperties.rowCount} 行`);
			console.log(`  編集できる範囲: ${U.gridRangeToA1(bodyBefore?.range)} → ${U.gridRangeToA1(bodyAfter?.range)}`);
			const grew = (bodyAfter?.range.endRowIndex ?? 0) > (bodyBefore?.range.endRowIndex ?? 0);
			console.log(`  保護範囲は伸びたか: ${grew ? 'はい（行を増やせば使える行も増える）' : 'いいえ（増やしても書ける範囲は増えない）'}`);
			results.rowInsert = {
				allowed: true,
				grew,
				rowCount: { before: rowsBefore, after: me2.properties.gridProperties.rowCount },
				body: { before: bodyBefore?.range, after: bodyAfter?.range },
			};
		} catch (err) {
			const e = U.describeError(err);
			console.log(`  挿入できませんでした: ${e.status} ${e.statusText ?? ''}`);
			console.log(`  メッセージ: ${e.message}`);
			results.rowInsert = { allowed: false, error: e };
		}

		if (inserted) {
			// 原状復帰。挿入した行をそのまま削除する
			await sheets.spreadsheets.batchUpdate({
				spreadsheetId,
				requestBody: {
					requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: insertAt - 1, endIndex: insertAt } } }],
				},
			});
			const restored = await sheets.spreadsheets.get({
				spreadsheetId,
				fields: 'sheets(properties(title,gridProperties(rowCount)),protectedRanges(range))',
			});
			const me3 = restored.data.sheets.find((s) => s.properties.title === mySheetName);
			const bodyBack = (me3.protectedRanges || []).find((p) => (p.range.startRowIndex ?? 0) === 7);
			const ok =
				me3.properties.gridProperties.rowCount === rowsBefore &&
				bodyBack?.range.endRowIndex === bodyBefore?.range.endRowIndex;
			console.log(`  削除して原状復帰: グリッド ${me3.properties.gridProperties.rowCount} 行 / 編集できる範囲 ${U.gridRangeToA1(bodyBack?.range)}`);
			console.log(`  元に戻ったか: ${ok ? 'はい' : '⚠ いいえ。手で確認してください'}`);
			results.rowInsert.restored = ok;
		}
	}

	hr('段階C-4  他人のシート');
	console.log('  段階A の requestingUserCanEdit が false なら、書き込みは試しません。');
	console.log('  A-read.json の「自分が編集できてしまうシート」が 0 枚であることを確認してください。');

	const saved = U.saveOut('C-verify-live.json', results);
	console.log(`\n全文を ${saved} に保存しました（Git 管理外）。`);
}

// --- 入口 -------------------------------------------------------------------

const COMMANDS = {
	read: cmdRead,
	sandbox: cmdSandbox,
	'write-sandbox': cmdWriteSandbox,
	'verify-live': cmdVerifyLive,
};

async function main() {
	const cmd = process.argv[2];
	if (!cmd || !COMMANDS[cmd]) {
		console.log('使い方: node tools/sheet-probe/probe.cjs <command>\n');
		console.log('  read           段階A 実シートの読み取りのみ。無害');
		console.log('  sandbox        段階B 自分のドライブへ複製し、他スタッフのシートを削る');
		console.log('  write-sandbox  段階B 複製に対して書き込みの挙動を試す');
		console.log('  verify-live    段階C 実シートへ1セルだけ書いて即消す。都度承認');
		console.log('\n  --yes を付けると承認を聞かない。事前に承認を得ている場合だけ使うこと。');
		process.exit(cmd ? 1 : 0);
	}
	loadEnv();
	try {
		await COMMANDS[cmd]();
	} finally {
		closeRl();
	}
}

main().catch((err) => {
	console.error(`\n[NG] ${err.message}`);
	const e = U.describeError(err);
	if (e.status) console.error(`     ${e.status} ${e.statusText ?? ''} ${e.message}`);
	process.exit(1);
});

#!/usr/bin/env node
// drive.file で、アプリが作っていない既存フォルダの下にファイルを作れるかを
// 実機で確かめる（Issue #61）。
//
// drive.file はアプリが作った／開いたファイルしか触れない。
// アプリが作っていない親フォルダを指定して files.create できるかが争点。
//
//   narrow   段階A  drive.file だけのトークンで試す（本題）
//   broad    段階B  drive（広い）トークンで同じことを試す（対照）
//   compare  段階C  2つの結果を並べて結論を出す
//
// 狭いほうだけで失敗しても、フォルダIDの打ち間違いでも同じ失敗になる。
// 広いほうが通って狭いほうが落ちて、初めて原因をスコープに帰せる。
//
// 検証先は、人が Drive 上に手で作ったフォルダだけを使う。
// プローブ自身にフォルダを作らせると、それはアプリが作ったフォルダになり、
// 確かめたい条件から外れる。実の領収書フォルダには触れない。
//
// 出力の全文は out/ へ書く（Git 管理外）。文書にもフォルダIDを書かない（N-08 / N-18）。

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { google } = require('googleapis');
const { getAuthClient, REPO_ROOT } = require('../sheet-probe/auth.cjs');

const DRIVE_FULL = 'https://www.googleapis.com/auth/drive';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

const OUT_DIR = path.join(__dirname, 'out');

const MODES = {
	narrow: {
		label: 'narrow',
		tokenFile: 'credentials/token-drive-file.json',
		scopes: [DRIVE_FILE],
		// 広い drive が混ざっていたら即座に中止する。取り違えると
		// 「drive.file でできた」と誤って報告される。
		forbid: [DRIVE_FULL],
		require: [DRIVE_FILE],
	},
	broad: {
		label: 'broad',
		tokenFile: 'credentials/token.json',
		scopes: undefined, // 既定（spreadsheets / drive / gmail.readonly）
		forbid: [],
		require: [DRIVE_FULL],
	},
};

function loadEnv() {
	const envFile = path.join(REPO_ROOT, '.env');
	if (!fs.existsSync(envFile)) {
		throw new Error(`.env がありません。.env.example を写して実値を入れてください: ${envFile}`);
	}
	process.loadEnvFile(envFile);
}

function requireEnv(name) {
	const v = process.env[name];
	if (!v) throw new Error(`.env に ${name} が設定されていません。`);
	return v;
}

function hr(label) {
	console.log(`\n${'='.repeat(76)}\n${label}\n${'='.repeat(76)}`);
}

function describeError(err) {
	const e = err?.response?.data?.error;
	if (e) return { status: err.response.status, code: e.code, message: e.message, statusText: e.status };
	return { status: err?.code ?? null, message: err?.message ?? String(err) };
}

function saveOut(name, data) {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const file = path.join(OUT_DIR, name);
	fs.writeFileSync(file, JSON.stringify(data, null, 2));
	return path.relative(REPO_ROOT, file);
}

function printError(err) {
	const e = describeError(err);
	const status = e.status != null ? String(e.status) : '—';
	const code = e.statusText || e.code || '';
	console.log(`  → 失敗  ${status} ${code}`);
	console.log(`     ${e.message}`);
	return e;
}

function grantedScopes(tokenInfo) {
	if (Array.isArray(tokenInfo?.scopes)) return tokenInfo.scopes;
	if (typeof tokenInfo?.scope === 'string') {
		return tokenInfo.scope.split(/[,\s]+/).filter(Boolean);
	}
	return [];
}

async function inspectScopes(auth) {
	const { token } = await auth.getAccessToken();
	if (!token) throw new Error('アクセストークンを取得できませんでした。');
	const info = await auth.getTokenInfo(token);
	return grantedScopes(info);
}

function assertScopes(mode, granted) {
	console.log('  想定スコープ:');
	for (const s of mode.scopes ?? ['（既定 = spreadsheets / drive / gmail.readonly）']) {
		console.log(`      ${s}`);
	}
	console.log('  付与スコープ:');
	if (granted.length === 0) {
		console.log('      （空）');
	} else {
		for (const s of granted) console.log(`      ${s}`);
	}

	const forbidden = mode.forbid.filter((s) => granted.includes(s));
	if (forbidden.length > 0) {
		throw new Error(
			`付与スコープに広い権限が混ざっています: ${forbidden.join(', ')}\n` +
				`トークン ${mode.tokenFile} を取り違えています。中止します。`,
		);
	}

	const missing = mode.require.filter((s) => !granted.includes(s));
	if (missing.length > 0) {
		throw new Error(
			`付与スコープに必要な権限がありません: ${missing.join(', ')}\n` +
				`${mode.tokenFile} を消して、このコマンドをもう一度走らせて認可し直してください。`,
		);
	}

	console.log('  → 想定どおり。取り違えは無い');
}

async function tryStep(label, fn) {
	try {
		const data = await fn();
		return { ok: true, data };
	} catch (err) {
		console.log(`  ${label}`);
		return { ok: false, error: printError(err) };
	}
}

async function runMode(mode) {
	const folderId = requireEnv('DRIVE_PROBE_FOLDER_ID');
	const out = {
		mode: mode.label,
		tokenFile: mode.tokenFile,
		expectedScopes: mode.scopes ?? ['default'],
		grantedScopes: [],
		folderGet: null,
		create: null,
		permission: null,
		webViewLink: null,
		cleanup: null,
	};

	hr(`${mode.label}  1  付与スコープを確認する`);
	const auth = await getAuthClient({
		tokenFile: mode.tokenFile,
		scopes: mode.scopes,
	});
	out.grantedScopes = await inspectScopes(auth);
	assertScopes(mode, out.grantedScopes);

	const drive = google.drive({ version: 'v3', auth });

	hr(`${mode.label}  2  既存フォルダのメタデータを読む`);
	out.folderGet = await tryStep('files.get', async () => {
		const res = await drive.files.get({
			fileId: folderId,
			fields: 'id,name,mimeType,capabilities(canAddChildren,canEdit,canShare)',
			supportsAllDrives: true,
		});
		const d = res.data;
		console.log(`  名前        : ${d.name}`);
		console.log(`  mimeType    : ${d.mimeType}`);
		console.log(`  canAddChildren : ${d.capabilities?.canAddChildren}`);
		console.log(`  canEdit     : ${d.capabilities?.canEdit}`);
		if (d.mimeType !== 'application/vnd.google-apps.folder') {
			throw new Error(`DRIVE_PROBE_FOLDER_ID がフォルダではありません（${d.mimeType}）。`);
		}
		return {
			name: d.name,
			mimeType: d.mimeType,
			capabilities: d.capabilities,
		};
	});

	hr(`${mode.label}  3  既存フォルダの下にファイルを作る（本題）`);
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const fileName = `expense-claim-drive-probe-${mode.label}-${stamp}.txt`;
	out.create = await tryStep('files.create', async () => {
		const res = await drive.files.create({
			requestBody: {
				name: fileName,
				parents: [folderId],
				mimeType: 'text/plain',
			},
			media: {
				mimeType: 'text/plain',
				body: Readable.from([`drive-probe ${mode.label} ${stamp}\n`]),
			},
			fields: 'id,name,parents,webViewLink',
			supportsAllDrives: true,
		});
		console.log(`  作成したファイル名: ${res.data.name}`);
		console.log(`  webViewLink の有無: ${res.data.webViewLink ? 'あり' : 'なし'}`);
		return {
			name: res.data.name,
			fileId: res.data.id,
			hasWebViewLink: Boolean(res.data.webViewLink),
			webViewLink: res.data.webViewLink ?? null,
		};
	});

	const createdId = out.create.ok ? out.create.data.fileId : null;

	if (createdId) {
		hr(`${mode.label}  4  共有を付ける（anyone / reader = F-25）`);
		out.permission = await tryStep('permissions.create', async () => {
			const res = await drive.permissions.create({
				fileId: createdId,
				requestBody: { type: 'anyone', role: 'reader' },
				fields: 'id,type,role',
				supportsAllDrives: true,
			});
			console.log(`  type=${res.data.type}  role=${res.data.role}`);
			return { type: res.data.type, role: res.data.role };
		});

		hr(`${mode.label}  5  提出シートに書く URL を取る（R-15）`);
		out.webViewLink = await tryStep('files.get(webViewLink)', async () => {
			const res = await drive.files.get({
				fileId: createdId,
				fields: 'id,webViewLink,webContentLink',
				supportsAllDrives: true,
			});
			const has = Boolean(res.data.webViewLink);
			console.log(`  webViewLink の有無: ${has ? 'あり' : 'なし'}`);
			return { hasWebViewLink: has, webViewLink: res.data.webViewLink ?? null };
		});

		hr(`${mode.label}  6  後片付け（作ったファイルを消す）`);
		out.cleanup = await tryStep('files.delete', async () => {
			await drive.files.delete({
				fileId: createdId,
				supportsAllDrives: true,
			});
			console.log('  削除しました。検証用フォルダにファイルは残っていない想定です。');
			return { deleted: true };
		});
		if (!out.cleanup.ok) {
			console.log('  ⚠ 削除できませんでした。検証用フォルダを目で見て、残っていれば手で消してください。');
			console.log(`     ファイル名: ${fileName}`);
		}
	} else {
		console.log('\n  3 が失敗したので 4〜6 は行いません。');
		out.permission = { ok: false, skipped: true };
		out.webViewLink = { ok: false, skipped: true };
		out.cleanup = { ok: true, skipped: true };
	}

	const saved = saveOut(`${mode.label}.json`, out);
	console.log(`\n全文を ${saved} に保存しました（Git 管理外）。`);
	return out;
}

function stepOk(step) {
	return Boolean(step && step.ok && !step.skipped);
}

function stepStatus(step) {
	if (!step) return '未実施';
	if (step.skipped) return 'スキップ';
	if (step.ok) return '成功';
	const e = step.error || {};
	return `失敗 ${e.status ?? ''} ${e.statusText || e.code || ''}`.trim();
}

function conclude(narrow, broad) {
	const n = stepOk(narrow.create);
	const b = stepOk(broad.create);
	if (b && !n) {
		return {
			cause: 'scope',
			summary:
				'広いほうが通って狭いほうが落ちた。原因はスコープである。drive.file では既存フォルダの下に作れない。',
		};
	}
	if (n && b) {
		return {
			cause: 'drive.file-sufficient',
			summary: 'drive.file だけで、アプリが作っていない既存フォルダの下にファイルを作れた。',
		};
	}
	if (!n && !b) {
		const ns = narrow.create?.error?.status;
		const bs = broad.create?.error?.status;
		if (ns != null && ns === bs) {
			return {
				cause: 'not-scope',
				summary: `両方とも ${ns} で失敗した。フォルダIDの打ち間違いやフォルダの消滅を疑え。スコープには帰せない。`,
			};
		}
		return {
			cause: 'unclear',
			summary: '両方失敗したがエラーが違う。フォルダとスコープの両方を疑え。',
		};
	}
	return {
		cause: 'unexpected',
		summary: '狭いほうが通って広いほうが落ちた。トークンの取り違えを疑え。',
	};
}

function loadResult(label) {
	const file = path.join(OUT_DIR, `${label}.json`);
	if (!fs.existsSync(file)) {
		throw new Error(
			`${path.relative(REPO_ROOT, file)} がありません。先に node tools/drive-probe/probe.cjs ${label} を走らせてください。`,
		);
	}
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function cmdCompare() {
	const narrow = loadResult('narrow');
	const broad = loadResult('broad');
	const conclusion = conclude(narrow, broad);

	hr('compare  付与スコープ');
	console.log('  narrow:');
	for (const s of narrow.grantedScopes || []) console.log(`      ${s}`);
	console.log('  broad:');
	for (const s of broad.grantedScopes || []) console.log(`      ${s}`);

	hr('compare  同じ操作の結果');
	const rows = [
		['フォルダのメタデータ', 'folderGet'],
		['既存フォルダの下に作成', 'create'],
		['anyone / reader の共有', 'permission'],
		['webViewLink', 'webViewLink'],
		['後片付け（削除）', 'cleanup'],
	];
	for (const [label, key] of rows) {
		console.log(`  ${label}`);
		console.log(`      narrow : ${stepStatus(narrow[key])}`);
		console.log(`      broad  : ${stepStatus(broad[key])}`);
	}

	hr('compare  結論');
	console.log(`  ${conclusion.summary}`);
	console.log(`  cause=${conclusion.cause}`);

	const saved = saveOut('compare.json', { narrow, broad, conclusion });
	console.log(`\n全文を ${saved} に保存しました（Git 管理外）。`);
}

const COMMANDS = {
	narrow: () => runMode(MODES.narrow),
	broad: () => runMode(MODES.broad),
	compare: cmdCompare,
};

async function main() {
	const cmd = process.argv[2];
	if (!cmd || !COMMANDS[cmd]) {
		console.log('使い方: node tools/drive-probe/probe.cjs <command>\n');
		console.log('  narrow   段階A  drive.file だけのトークンで試す（本題）');
		console.log('  broad    段階B  drive（広い）トークンで同じことを試す（対照）');
		console.log('  compare  段階C  2つの結果を並べて結論を出す');
		process.exit(cmd ? 1 : 0);
	}
	loadEnv();
	await COMMANDS[cmd]();
}

main().catch((err) => {
	console.error(`\n[NG] ${err.message}`);
	const e = describeError(err);
	if (e.status) console.error(`     ${e.status} ${e.statusText ?? ''} ${e.message}`);
	process.exit(1);
});

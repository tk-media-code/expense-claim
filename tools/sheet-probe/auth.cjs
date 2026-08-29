// OAuth のループバック認可。取得したトークンを保存し、2回目以降は再利用する。
//
// @google-cloud/local-auth は使わない。ブラウザを自動起動する実装で、WSL2 では
// Windows 側のブラウザを開けずに詰まるため。ここでは認可 URL を端末に出力して
// 人に貼ってもらい、リダイレクトを2つの経路で受け取る。
//
//   経路1: 127.0.0.1 にサーバーを立てて受け取る（WSL2 の localhost 転送が効く場合）
//   経路2: 転送が効かない場合の逃げ道。リダイレクト先 URL を端末に貼り付けてもらう
//
// かつての手動コピー用フロー（urn:ietf:wg:oauth:2.0:oob）は廃止済みで使えない。

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');
const { OAuth2Client } = require('google-auth-library');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// 今回の検証で要るスコープ。
// drive.file ではアプリが作ったファイルしか触れず、委託元のシートを複製できないため
// drive を使う。対象ユーザーが「内部」の Workspace アプリなら審査は不要。
const SCOPES = [
	'https://www.googleapis.com/auth/spreadsheets',
	'https://www.googleapis.com/auth/drive',
	'https://www.googleapis.com/auth/gmail.readonly',
];

function resolveFromRoot(p) {
	return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

// リダイレクトを受ける URL を組み立てる。デスクトップアプリのクライアントは
// localhost の任意のポートを受け付けるため、コンソール側への登録は要らない。
function redirectUri(port) {
	return `http://127.0.0.1:${port}/oauth2callback`;
}

function readClientSecret(clientFile) {
	const file = resolveFromRoot(clientFile);
	if (!fs.existsSync(file)) {
		throw new Error(
			`OAuth クライアントの JSON が見つかりません: ${file}\n` +
				'Google Cloud コンソール（https://console.cloud.google.com/auth/clients）で\n' +
				'「デスクトップ アプリ」のクライアントを作り、JSON をこのパスへ置いてください。',
		);
	}
	const json = JSON.parse(fs.readFileSync(file, 'utf8'));
	// デスクトップアプリは installed、ウェブは web の下に入る
	const cred = json.installed || json.web;
	if (!cred || !cred.client_id || !cred.client_secret) {
		throw new Error(
			`${file} が OAuth クライアントの JSON に見えません。` +
				'「デスクトップ アプリ」で作ったものをダウンロードし直してください。',
		);
	}
	return cred;
}

// 認可コードを2経路のどちらか早いほうから受け取る。
function waitForCode(client, port, authUrl) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			server.close();
			rl.close();
			fn(value);
		};

		const server = http.createServer((req, res) => {
			const url = new URL(req.url, `http://127.0.0.1:${port}`);
			const code = url.searchParams.get('code');
			const error = url.searchParams.get('error');
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			if (code) {
				res.end('<h1>認可しました</h1><p>このタブを閉じて端末へ戻ってください。</p>');
				finish(resolve, code);
			} else {
				res.end(`<h1>認可できませんでした</h1><p>${error || '不明なエラー'}</p>`);
				finish(reject, new Error(`認可が拒否されました: ${error || '不明なエラー'}`));
			}
		});

		server.on('error', (err) => finish(reject, err));

		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

		server.listen(port, '127.0.0.1', () => {
			console.log('\n次の URL をブラウザで開き、Workspace（独自ドメイン）のアカウントで認可してください。\n');
			console.log(authUrl);
			console.log(
				'\n認可するとブラウザがこの端末へ戻ってきます。' +
					'\nもし「接続できません」と表示されたら、そのときのアドレスバーの URL を丸ごと貼り付けて Enter を押してください。\n',
			);
			rl.on('line', (line) => {
				const text = line.trim();
				if (!text) return;
				try {
					// URL を丸ごと貼られた場合と、code だけを貼られた場合の両方を受ける
					const code = text.startsWith('http')
						? new URL(text).searchParams.get('code')
						: text;
					if (!code) {
						console.log('URL に code が含まれていません。もう一度貼り付けてください。');
						return;
					}
					finish(resolve, code);
				} catch {
					console.log('URL として読めませんでした。もう一度貼り付けてください。');
				}
			});
		});
	}).then((code) => client.getToken({ code, redirect_uri: redirectUri(port) }));
}

// 認可済みのクライアントを返す。トークンがあれば使い回し、無ければ認可フローに入る。
async function getAuthClient({ clientFile, tokenFile, port = 5710 } = {}) {
	const cf = clientFile || process.env.OAUTH_CLIENT_FILE || 'credentials/oauth-client.json';
	const tf = resolveFromRoot(tokenFile || process.env.OAUTH_TOKEN_FILE || 'credentials/token.json');

	const cred = readClientSecret(cf);
	const client = new OAuth2Client(cred.client_id, cred.client_secret, redirectUri(port));

	// リフレッシュで新しいトークンが降ってきたら書き戻す
	client.on('tokens', (tokens) => {
		const current = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, 'utf8')) : {};
		fs.writeFileSync(tf, JSON.stringify({ ...current, ...tokens }, null, 2), { mode: 0o600 });
	});

	if (fs.existsSync(tf)) {
		client.setCredentials(JSON.parse(fs.readFileSync(tf, 'utf8')));
		return client;
	}

	const authUrl = client.generateAuthUrl({
		access_type: 'offline', // リフレッシュトークンを受け取るため
		prompt: 'consent', // 2回目以降も確実にリフレッシュトークンを得るため
		scope: SCOPES,
	});

	const { tokens } = await waitForCode(client, port, authUrl);
	fs.mkdirSync(path.dirname(tf), { recursive: true });
	fs.writeFileSync(tf, JSON.stringify(tokens, null, 2), { mode: 0o600 });
	client.setCredentials(tokens);
	console.log(`\n認可しました。トークンを ${path.relative(REPO_ROOT, tf)} に保存しました。\n`);
	return client;
}

module.exports = { getAuthClient, SCOPES, REPO_ROOT, resolveFromRoot };

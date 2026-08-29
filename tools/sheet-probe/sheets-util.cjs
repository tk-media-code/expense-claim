// Sheets API の戻り値を読むための小道具。

const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./auth.cjs');

const OUT_DIR = path.join(__dirname, 'out');

// 0 始まりの列番号を A1 記法の列名にする。0 -> A, 25 -> Z, 26 -> AA
function colName(index) {
	let n = index;
	let s = '';
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}

// GridRange を A1 記法にする。端が省略されている場合は無制限を意味するので、
// その辺は開いたまま表す（例 8:∞ や A:M）。
function gridRangeToA1(range, title) {
	if (!range) return title ? `${title}（シート全体）` : 'シート全体';
	const { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = range;
	const c1 = startColumnIndex == null ? '' : colName(startColumnIndex);
	const c2 = endColumnIndex == null ? '' : colName(endColumnIndex - 1);
	const r1 = startRowIndex == null ? '' : String(startRowIndex + 1);
	const r2 = endRowIndex == null ? '' : String(endRowIndex);

	const noCols = c1 === '' && c2 === '';
	const noRows = r1 === '' && r2 === '';
	let body;
	if (noCols && noRows) body = 'シート全体';
	else if (noCols) body = `${r1 || '1'}:${r2 || '末尾'}行`;
	else if (noRows) body = `${c1 || 'A'}:${c2 || '末尾'}列`;
	else body = `${c1 || 'A'}${r1 || '1'}:${c2 || '末尾'}${r2 || '末尾'}`;
	return title ? `${title}!${body}` : body;
}

// GridRange が指定の行を含むか。端の省略は無制限として扱う。
function rangeCoversRow(range, rowIndex) {
	if (!range) return true;
	const from = range.startRowIndex ?? 0;
	const to = range.endRowIndex ?? Number.POSITIVE_INFINITY;
	return rowIndex >= from && rowIndex < to;
}

// セルに値が入っているか。空文字だけの数式セルも「入っている」と見る。
function cellHasValue(cell) {
	const v = cell?.userEnteredValue;
	if (!v) return false;
	if (v.stringValue != null) return v.stringValue !== '';
	return v.numberValue != null || v.boolValue != null || v.formulaValue != null;
}

// セルの中身を人が読める1行にする。
function describeCell(cell) {
	const v = cell?.userEnteredValue;
	if (!v) return '';
	if (v.formulaValue != null) return v.formulaValue;
	if (v.stringValue != null) return v.stringValue;
	if (v.numberValue != null) return `${v.numberValue}${cell.formattedValue ? ` (${cell.formattedValue})` : ''}`;
	if (v.boolValue != null) return String(v.boolValue);
	return '';
}

// 数式に出てくる範囲参照を拾う。合計式がどこまで集計しているかを見るために使う。
function extractRanges(formula) {
	if (!formula) return [];
	const m = formula.match(/\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+/g);
	return m ? [...new Set(m)] : [];
}

function saveOut(name, data) {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const file = path.join(OUT_DIR, name);
	fs.writeFileSync(file, JSON.stringify(data, null, 2));
	return path.relative(REPO_ROOT, file);
}

// API のエラーを、原因が分かる形に潰す。
function describeError(err) {
	const e = err?.response?.data?.error;
	if (e) return { status: err.response.status, code: e.code, message: e.message, statusText: e.status };
	return { status: err?.code ?? null, message: err?.message ?? String(err) };
}

module.exports = {
	OUT_DIR,
	colName,
	gridRangeToA1,
	rangeCoversRow,
	cellHasValue,
	describeCell,
	extractRanges,
	saveOut,
	describeError,
};

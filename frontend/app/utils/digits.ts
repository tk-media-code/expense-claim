// 金額の入力欄は type="text" + inputmode="numeric" で受ける（type="number" は、フォーカスのある欄の上で
// マウスホイールを回すと値が 1 ずつ変わり、200 が 199 になった・2026-09-18 実測）。
// type="text" だと PC の IME で全角の数字が入りうるので、送る前に半角へ寄せる。検証はサーバーが行う。

/** 全角の数字を半角にする。それ以外の文字はそのまま */
export function toHalfWidthDigits(value: string): string {
	return value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 見た目はモックに合わせない。Nuxt UI の既定テーマに委ねる（02-screens.md 7章）。
// ここで決めるのは色だけで、それ以上は作り込まない。
// 配色とタイポグラフィの作り込みは「導線が固まってから」の宿題である。
export default defineAppConfig({
	ui: {
		colors: {
			primary: 'teal',
			neutral: 'slate',
		},
	},
});

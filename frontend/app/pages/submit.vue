<script setup lang="ts">
import type { SubmissionPreview, SubmissionResult } from '~/types/submission';
import type { ApiError } from '~/utils/api-error';

definePageMeta({
	title: '提出',
	back: '/',
});

const api = useApi();

// 確認 → 実行 → 結果（02-screens.md 3.9）。確認と実行は別のリクエストで、実行は手順1〜7 をやり直す（04-api.md 6.1）
type Stage = 'loading' | 'confirm' | 'executing' | 'done' | 'aborted';
const stage = ref<Stage>('loading');
const preview = ref<SubmissionPreview | null>(null);
const result = ref<SubmissionResult | null>(null);
const abort = ref<ApiError | null>(null);

async function loadPreview() {
	stage.value = 'loading';
	abort.value = null;
	try {
		// GET にしない（6.3）。外部 API を叩き、要確認事項を残しうる
		preview.value = await api<SubmissionPreview>('/submissions/preview', { method: 'POST' });
		stage.value = 'confirm';
	} catch (cause) {
		// 中止の理由を出す（3.9）。アプリ側では直せないものが混じる（N-13）。認可切れはトーストが設定へ導く
		abort.value = cause as ApiError;
		stage.value = 'aborted';
	}
}

async function execute() {
	if (!preview.value) return;
	stage.value = 'executing';
	abort.value = null;
	try {
		// 本文は確認した対象月度だけ（6.2）。読み直した A1 と違えば 409 で止まる
		result.value = await api<SubmissionResult>('/submissions', {
			method: 'POST',
			body: { targetMonth: preview.value.targetMonth },
		});
		stage.value = 'done';
	} catch (cause) {
		abort.value = cause as ApiError;
		stage.value = 'aborted';
	}
}

onMounted(() => {
	void loadPreview();
});

// 対象月度に記録済みの案件が1件も無ければ押せない（3.2 / 3.9）。書き込む行が0行になる
const submittable = computed(() => (preview.value?.rows.length ?? 0) > 0);
const hasOneWay = computed(
	() => preview.value?.rows.some((row) => row.cells.G === '片道') ?? false,
);
const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;
const headers: Record<(typeof columns)[number], string> = {
	A: '日付',
	B: '会場',
	C: '目的',
	D: '案件名',
	E: '出発駅',
	F: '到着駅',
	G: '往復',
	H: '金額',
	I: 'タクシー',
};
</script>

<template>
	<div class="space-y-6">
		<div v-if="stage === 'loading'" class="space-y-2" data-testid="loading">
			<p class="text-muted text-sm">提出シートを読んで、書き込む内容を組み立てています…</p>
			<USkeleton v-for="n in 3" :key="n" class="h-10 w-full" />
		</div>

		<!-- 中止。1行も書いていない（3.9）。理由を出す -->
		<div v-else-if="stage === 'aborted' && abort" class="space-y-3" data-testid="aborted">
			<UAlert
				color="error"
				variant="subtle"
				icon="i-lucide-octagon-x"
				title="中止しました。何も書いていません"
				:description="abort.message"
			/>
			<p v-if="abort.code === 'TARGET_MONTH_CHANGED'" class="text-muted text-sm">
				確認と実行のあいだに提出シートの月度が変わりました。もう一度確認からやり直してください。
			</p>
			<p v-else-if="abort.code === 'SHEET_FORMAT_CHANGED'" class="text-muted text-sm">
				提出シートの様式が想定と違います。アプリ側では直せません。実装を直すまでは手で入力してください（NF-10）。
			</p>
			<UButton variant="outline" @click="loadPreview">もう一度確認する</UButton>
		</div>

		<!-- 結果 -->
		<div v-else-if="stage === 'done' && result" class="space-y-3" data-testid="done">
			<UAlert
				color="success"
				variant="subtle"
				icon="i-lucide-check-circle"
				title="提出シートに書き込みました"
				:description="`${result.writtenRows} 行を書きました。${result.rowsInserted > 0 ? `本文行が足りず ${result.rowsInserted} 行を挿入しました（要確認事項に残っています）。` : ''}`"
			/>
			<ul v-if="result.warnings.length > 0" class="space-y-1 text-sm" data-testid="result-warnings">
				<li v-for="(warning, i) in result.warnings" :key="i" class="text-warning">
					{{ warning.message }}
				</li>
			</ul>
			<p class="text-muted text-sm">
				何度でも実行できる（F-29）。直したいところがあれば、アプリ側を直してもう一度提出する。
			</p>
			<UButton to="/" variant="outline">ホームへ戻る</UButton>
		</div>

		<div v-else-if="stage === 'executing'" class="space-y-2" data-testid="executing">
			<p class="text-sm">提出シートを読み直し、書き込んでいます…</p>
			<UProgress animation="carousel" />
		</div>

		<!-- 確認 -->
		<template v-else-if="preview">
			<div class="flex items-center justify-between">
				<h2 class="font-semibold">{{ formatMonth(preview.targetMonth) }}の提出</h2>
				<UBadge color="neutral" variant="subtle" data-testid="last-submitted">
					{{
						preview.lastSubmittedAt
							? `前回 ${formatDateTime(preview.lastSubmittedAt)}`
							: 'まだ提出していない'
					}}
				</UBadge>
			</div>

			<!-- 警告。知らせて続ける（04-api.md 2.6） -->
			<ul v-if="preview.warnings.length > 0" class="space-y-2" data-testid="warnings">
				<li v-for="(warning, i) in preview.warnings" :key="i">
					<UAlert
						color="warning"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						:title="warning.message"
					/>
				</li>
			</ul>
			<UAlert
				v-if="preview.attentionCount > 0"
				color="neutral"
				variant="subtle"
				icon="i-lucide-bell"
				:title="`未確認の要確認事項が ${preview.attentionCount} 件あります`"
				description="提出は要確認事項があっても実行できる。気になるなら先に見る。"
				:actions="[
					{ label: '要確認事項を見る', to: '/attentions', color: 'neutral', variant: 'outline' },
				]"
			/>
			<!-- 挿入はシートの構造を変える操作。実行する前に知らせる（5.4） -->
			<UAlert
				v-if="preview.rowsToInsert > 0"
				color="warning"
				variant="subtle"
				icon="i-lucide-rows-3"
				:title="`本文行が ${preview.rowsToInsert} 行足りないので、提出時に挿入します`"
				:description="`書ける行数 ${preview.writableRows} 行に対して ${preview.rows.length} 行。挿入したことは要確認事項に残ります。`"
				data-testid="rows-to-insert"
			/>
			<UAlert
				v-if="hasOneWay"
				color="info"
				variant="subtle"
				icon="i-lucide-eye"
				title="「片道」の行があります"
				description="往路と復路で違うルートを使った案件です。まだ一度も書いたことのない書き方なので、目で確かめてください。"
				data-testid="one-way"
			/>

			<!-- 行の一覧は提出シートの列（A〜I）そのままの形（F-27 / R-17）。画面が組み立て直さない -->
			<section class="space-y-2">
				<h3 class="font-semibold">書き込む行（{{ preview.rows.length }}行）</h3>
				<p v-if="preview.rows.length === 0" class="text-muted text-sm">
					対象月度に記録済みの案件が無いので、書き込む行がありません。
				</p>
				<div v-else class="overflow-x-auto">
					<table class="w-full text-sm whitespace-nowrap" data-testid="rows">
						<thead>
							<tr class="text-muted border-default border-b text-left">
								<th class="px-2 py-1">#</th>
								<th v-for="col in columns" :key="col" class="px-2 py-1">
									{{ col }} {{ headers[col] }}
								</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="row in preview.rows" :key="row.no" class="border-default border-b">
								<td class="text-muted px-2 py-1 tabular-nums">{{ row.no }}</td>
								<td
									v-for="col in columns"
									:key="col"
									class="px-2 py-1"
									:class="{ 'text-right tabular-nums': col === 'H' || col === 'I' }"
								>
									{{ row.cells[col] ?? '' }}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>

			<!-- 領収書欄は行ではなく1つのセル（5.4）。乗車の数と行の数は一致しない -->
			<section class="space-y-2">
				<h3 class="font-semibold">領収書欄（M8）</h3>
				<pre
					v-if="preview.receiptCell"
					class="bg-elevated overflow-x-auto rounded p-2 text-xs"
					data-testid="receipt-cell"
					>{{ preview.receiptCell }}</pre>
				<p v-else class="text-muted text-sm">領収書はありません。</p>
			</section>

			<div class="space-y-2">
				<UButton :disabled="!submittable" size="lg" block data-testid="submit" @click="execute"
					>提出する</UButton
				>
				<p v-if="!submittable" class="text-muted text-sm">書き込む行が無いので、提出できません。</p>
				<p class="text-muted text-xs">
					本文行を全部消してから書き直す（決定2）。提出シートを手で直しても、次の提出で消える。
				</p>
			</div>
		</template>
	</div>
</template>

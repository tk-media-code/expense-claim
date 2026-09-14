<script setup lang="ts">
import type { Home, HomeMonth, HomeProject } from '~/types/home';

definePageMeta({
	title: 'ホーム',
	menu: true,
});

// 集約の1本（04-api.md 4.3）。DB しか読まないので待たされない。取り込み（POST /api/sync）は 9-5 で足す
const { data, status, error, refresh } = await useApiFetch<Home>('/home');

const home = computed(() => data.value ?? null);
const today = todayInJst();

// 02-screens.md 3.2 の月度の状態
function stateLabel(month: HomeMonth): string {
	switch (month.state) {
		case 'due':
			return '提出待ち';
		case 'submitted':
			return month.submittedAt ? `提出済み（${formatDateTime(month.submittedAt)}）` : '提出済み';
		case 'upcoming':
			return 'これから稼働';
	}
}

function stateColor(month: HomeMonth): 'warning' | 'success' | 'neutral' {
	return month.state === 'due' ? 'warning' : month.state === 'submitted' ? 'success' : 'neutral';
}

// 「施行前」の強調はクライアントが決めてよい（04-api.md 3.2）。間違えても表示が変わるだけで、データは壊れない
function upcoming(project: HomeProject): boolean {
	return isUpcoming(project.serviceDate, today);
}

// 「記録する」を出すのは、施行済みで未記録のカードだけ（3.2）。
// 記録済みは埋まっており、施行前はまだ記録できない。押せないボタンを並べるより、出さないほうがよい
function canRecord(project: HomeProject): boolean {
	return !project.recorded && !upcoming(project);
}

// 対象月度に記録済みの案件が1件も無ければ「提出」を非活性にする（3.2）。
// 書き込む行が0行になり、押しても何も起きない。押せない理由を添える
const submittable = computed(() =>
	(home.value?.months ?? []).some(
		(month) => month.state !== 'upcoming' && month.projects.some((p) => p.recorded),
	),
);

// cron は毎日走る。2日空けば落ちている（06-error-handling.md 7.2）
const cronStale = computed(() => {
	const at = home.value?.lastCronRunAt;
	return at ? daysBetween(at) >= 2 : false;
});
</script>

<template>
	<div class="space-y-6">
		<div v-if="status === 'pending'" class="space-y-2">
			<USkeleton v-for="n in 3" :key="n" class="h-28 w-full" />
		</div>

		<div v-else-if="error || !home" class="space-y-3">
			<p class="text-muted text-sm">案件の一覧を読み込めませんでした。</p>
			<UButton variant="outline" @click="refresh()">もう一度読み込む</UButton>
		</div>

		<template v-else>
			<!-- 要確認事項は0件なら出さない（4.4）。常時「0件」を出すと、増えたことに気づけなくなる -->
			<UAlert
				v-if="home.attentionCount > 0"
				color="warning"
				variant="subtle"
				icon="i-lucide-bell"
				:title="`要確認事項が${home.attentionCount}件あります`"
				:actions="[{ label: '見る', to: '/attentions', color: 'warning', variant: 'solid' }]"
				data-testid="attention-count"
			/>

			<p v-if="home.months.length === 0" class="text-muted text-sm">
				案件がありません。依頼メールが取り込まれると、ここに並びます。
			</p>

			<!-- 月度ごとに区切る（4.2）。月末から月初にかけて2つの月が並走する -->
			<section
				v-for="month in home.months"
				:key="month.month"
				class="space-y-3"
				data-testid="month"
			>
				<h2 class="flex items-center gap-2 font-semibold">
					{{ formatMonth(month.month) }}
					<UBadge :color="stateColor(month)" variant="subtle">{{ stateLabel(month) }}</UBadge>
				</h2>

				<ul class="space-y-3">
					<li v-for="project in month.projects" :key="project.id" data-testid="project">
						<UCard :ui="{ body: 'p-3 sm:p-4', footer: 'p-3 sm:p-4' }">
							<!-- カード本体をタップすると詳細へ。修正と削除はそこにしか無い（3.3） -->
							<NuxtLink :to="`/projects/${project.id}`" class="block">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<!-- 案件を取り違えないための3項目（2.3）。押す前にカードで見える -->
										<p class="font-semibold">
											{{ formatServiceDate(project.serviceDate) }} · {{ project.venueName }}
										</p>
										<p class="text-muted text-sm">{{ project.coupleName }}</p>
									</div>
									<UBadge
										v-if="upcoming(project)"
										color="neutral"
										variant="subtle"
										class="shrink-0"
									>
										施行前
									</UBadge>
									<UBadge
										v-else-if="project.recorded"
										color="success"
										variant="subtle"
										class="shrink-0"
									>
										記録済み
									</UBadge>
									<!-- 未記録は目立たせる（4.1）。提出までに埋める必要がある -->
									<UBadge v-else color="warning" variant="solid" class="shrink-0">未記録</UBadge>
								</div>
								<p v-if="project.recorded" class="text-muted mt-1 text-sm">
									{{ (project.totalAmount ?? 0).toLocaleString() }}円
									<span v-if="project.taxiCount > 0"> · タクシー{{ project.taxiCount }}回</span>
								</p>
							</NuxtLink>

							<!-- 2.2 の1手目。未記録のカードにだけ出す。ルート0本の会場でも出し、記録画面が導く（4.3） -->
							<template v-if="canRecord(project)" #footer>
								<UButton :to="`/projects/${project.id}/record`" icon="i-lucide-pen-line" block>
									記録する
								</UButton>
							</template>
						</UCard>
					</li>
				</ul>
			</section>

			<div class="space-y-2">
				<!-- 非活性のときはリンクにしない。disabled のアンカーは押せてしまう -->
				<UButton
					:to="submittable ? '/submit' : undefined"
					variant="outline"
					:disabled="!submittable"
					block
					data-testid="submit"
				>
					提出
				</UButton>
				<!-- 理由の見えない非活性は、故障と区別がつかない（3.2） -->
				<p v-if="!submittable" class="text-muted text-sm">
					対象月度に記録済みの案件が無いので、提出できるものがありません。
				</p>
			</div>

			<!-- 静かな故障に気づくための2行（要件定義 10章 / 06-error-handling.md 7章） -->
			<dl class="text-muted space-y-1 text-sm" data-testid="sync-info">
				<div class="flex gap-2">
					<dt class="shrink-0">最後に取り込んだ日時</dt>
					<dd>
						{{ home.lastImportedAt ? formatDateTime(home.lastImportedAt) : 'まだ取り込んでいない' }}
					</dd>
				</div>
				<div class="flex gap-2" :class="{ 'text-warning font-semibold': cronStale }">
					<dt class="shrink-0">提出アラートが最後に動いた日時</dt>
					<dd>
						{{ home.lastCronRunAt ? formatDateTime(home.lastCronRunAt) : 'まだ動いていない' }}
						<span v-if="cronStale">（2日以上前。止まっている可能性があります）</span>
					</dd>
				</div>
			</dl>
		</template>
	</div>
</template>

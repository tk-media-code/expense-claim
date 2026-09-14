<script setup lang="ts">
import type { Project, ProjectFormValue } from '~/types/project';
import type { Venue } from '~/types/venue';

definePageMeta({
	title: '案件の詳細',
	back: '/',
});

const api = useApi();
const route = useRoute();
const router = useRouter();
const id = String(route.params.id);

// 資源単位（04-api.md 3.1）。経路から外れた画面なので集約しない
const { data, status, error, refresh } = await useApiFetch<Project>(`/projects/${id}`);
const venuesFetch = await useApiFetch<{ venues: Venue[] }>('/venues');
const venues = computed(() => venuesFetch.data.value?.venues ?? []);

const project = computed(() => data.value ?? null);
const form = ref<ProjectFormValue>({
	projectNo: '',
	serviceDate: '',
	venueCode: '',
	coupleName: '',
});

// 読み込んだ値を入力欄に写す。読み直しても打ちかけを上書きしないよう、id が変わったときだけ
watch(
	project,
	(p) => {
		if (p) {
			form.value = {
				projectNo: p.projectNo,
				serviceDate: p.serviceDate,
				venueCode: p.venueCode,
				coupleName: p.coupleName,
			};
		}
	},
	{ immediate: true },
);

const today = todayInJst();
// 施行前は「記録する」を押せない（3.3 / 4.1）。記録が既にあるなら押せる（4-5 で足す）
const upcoming = computed(() =>
	project.value ? isUpcoming(project.value.serviceDate, today) : false,
);

const saving = ref(false);
const confirmOpen = ref(false);
const deleting = ref(false);

async function save() {
	saving.value = true;
	try {
		await api<Project>(`/projects/${id}`, { method: 'PATCH', body: form.value });
		await refresh();
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している。打った内容は残す
	} finally {
		saving.value = false;
	}
}

async function remove() {
	deleting.value = true;
	try {
		await api(`/projects/${id}`, { method: 'DELETE' });
		confirmOpen.value = false;
		await router.push('/');
	} catch {
		// 同上
	} finally {
		deleting.value = false;
	}
}

function sourceLabel(p: Project) {
	return p.source === 'mail' ? '自動取込' : '手動追加';
}
</script>

<template>
	<div class="space-y-6">
		<div v-if="status === 'pending'" class="space-y-2">
			<USkeleton v-for="n in 4" :key="n" class="h-10 w-full" />
		</div>

		<div v-else-if="error || !project" class="space-y-3">
			<p class="text-muted text-sm">案件を読み込めませんでした。</p>
			<UButton variant="outline" @click="refresh()">もう一度読み込む</UButton>
		</div>

		<template v-else>
			<div class="flex items-start justify-between gap-2">
				<div>
					<p class="font-semibold">
						{{ formatServiceDate(project.serviceDate) }} · {{ project.venueName }}
					</p>
					<p class="text-muted text-sm">{{ project.coupleName }}</p>
				</div>
				<UBadge color="neutral" variant="subtle" class="shrink-0">{{
					sourceLabel(project)
				}}</UBadge>
			</div>

			<!-- 記録の要約（3.3）。記録済みの記録を直す入口はここである。4-5 で要約が入る -->
			<UCard data-testid="record-summary">
				<p class="text-muted text-sm">まだ交通費を記録していない。</p>
				<template #footer>
					<UButton
						:to="upcoming ? undefined : `/projects/${project.id}/record?from=detail`"
						:disabled="upcoming"
						icon="i-lucide-pen-line"
						block
						data-testid="record"
					>
						記録する
					</UButton>
					<!-- 押せない理由を添える -->
					<p v-if="upcoming" class="text-muted mt-2 text-sm">施行前なので、まだ記録できない。</p>
				</template>
			</UCard>

			<form class="space-y-4" @submit.prevent="save">
				<h2 class="font-semibold">項目を直す</h2>
				<ProjectFields v-model="form" :venues="venues" />
				<p class="text-muted text-sm">
					<b>施行日を直すと、所属する月度が変わる</b>（決定12）。会場を選び直すと会場名も変わる。
				</p>
				<UButton type="submit" :loading="saving" variant="outline" block>この内容で直す</UButton>
			</form>

			<UButton color="error" variant="subtle" block @click="confirmOpen = true"
				>この案件を削除する</UButton
			>

			<!-- 3.3。確認ダイアログに「記録も消える」「ドライブの実体は消さない」の2つを書く -->
			<ConfirmDialog
				v-model:open="confirmOpen"
				title="この案件を削除する"
				description="この案件に紐づく交通費の記録・タクシー乗車・領収書のレコードも消える。ドライブに保存した領収書のファイルは消えない。"
				confirm-label="削除する"
				:loading="deleting"
				@confirm="remove"
			/>
		</template>
	</div>
</template>

<script setup lang="ts">
import type { Project, ProjectFormValue } from '~/types/project';
import type { Venue } from '~/types/venue';

definePageMeta({
	title: '案件の追加',
	back: '/',
});

const api = useApi();
const router = useRouter();

// 開いたときに叩く（04-api.md 8章）。会場を選ばせるための一覧
const { data } = await useApiFetch<{ venues: Venue[] }>('/venues');
const venues = computed(() => data.value?.venues ?? []);

const form = ref<ProjectFormValue>({
	projectNo: '',
	serviceDate: '',
	venueCode: '',
	coupleName: '',
});
const saving = ref(false);

async function submit() {
	saving.value = true;
	try {
		// source は送らない。手で足せば manual になる（04-api.md 4.4 / 7章）
		await api<Project>('/projects', { method: 'POST', body: form.value });
		await router.push('/');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している。打った内容は残す
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<form class="space-y-6" @submit.prevent="submit">
		<!-- 3.4。空でよいように見えると、面倒なときに空で登録されてしまう。案件番号は必須である -->
		<p class="text-muted text-sm">
			手で足すのは、<b>依頼メールが正常に取り込まれなかったとき</b>だけ。メール自体は届いていて、
			<b>案件番号はそこに書かれている。</b>見て入力する。同じ案件番号は登録できない。
		</p>
		<ProjectFields v-model="form" :venues="venues" />
		<UButton type="submit" :loading="saving" block>追加する</UButton>
	</form>
</template>

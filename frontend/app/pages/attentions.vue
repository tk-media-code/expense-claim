<script setup lang="ts">
import { ATTENTION_KIND_LABELS, type Attention } from '~/types/attention';

definePageMeta({
	title: '要確認事項',
	back: '/',
});

const api = useApi();

// 未確認だけを出す（04-api.md 8章の ?checked=false）。確認済みは消えたように見えるが、行は残っている
const { data, status, error, refresh } = await useApiFetch<{ attentions: Attention[] }>(
	'/attentions?checked=false',
);
const attentions = computed(() => data.value?.attentions ?? []);

const checking = ref<number | null>(null);

async function check(attention: Attention) {
	checking.value = attention.id;
	try {
		await api(`/attentions/${attention.id}/check`, { method: 'POST' });
		await refresh();
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している
	} finally {
		checking.value = null;
	}
}
</script>

<template>
	<div class="space-y-4">
		<div v-if="status === 'pending'" class="space-y-2">
			<USkeleton v-for="n in 3" :key="n" class="h-20 w-full" />
		</div>

		<div v-else-if="error" class="space-y-3">
			<p class="text-muted text-sm">要確認事項を読み込めませんでした。</p>
			<UButton variant="outline" @click="refresh()">もう一度読み込む</UButton>
		</div>

		<p v-else-if="attentions.length === 0" class="text-muted text-sm">
			未確認の要確認事項はありません。
		</p>

		<ul v-else class="space-y-3">
			<li v-for="attention in attentions" :key="attention.id" data-testid="attention">
				<UCard :ui="{ body: 'p-3 sm:p-4', footer: 'p-3 sm:p-4' }">
					<div class="flex items-start justify-between gap-2">
						<UBadge color="warning" variant="subtle">{{
							ATTENTION_KIND_LABELS[attention.kind]
						}}</UBadge>
						<span class="text-muted shrink-0 text-xs">{{
							formatDateTime(attention.occurredAt)
						}}</span>
					</div>
					<!-- 文面は素のテキスト1本（06-error-handling.md 4章）。画面は組み立て直さない -->
					<p class="mt-2 text-sm whitespace-pre-wrap">{{ attention.detail }}</p>
					<template #footer>
						<UButton
							icon="i-lucide-check"
							variant="outline"
							size="sm"
							:loading="checking === attention.id"
							@click="check(attention)"
						>
							確認済みにする
						</UButton>
					</template>
				</UCard>
			</li>
		</ul>
	</div>
</template>

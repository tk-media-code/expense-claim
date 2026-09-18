<script setup lang="ts">
import type { Venue, VenueRoute } from '~/types/venue';

definePageMeta({
	title: '会場とルート',
	back: '/',
});

const api = useApi();
const { data, status, error, refresh } = await useApiFetch<{ venues: Venue[] }>('/venues');

// 並びはサーバーが決めている（会場コード順）。画面では並べ替えない
const venues = computed(() => data.value?.venues ?? []);

// 絞り込みは画面が行う（F-38 / 04-api.md 4.7）。43件を全件受け取っているので、サーバーへ聞かない。
// 会場コードと会場名の両方で引く。依頼メールに載るのはコードだが、目に入っているのは名前のほう（3.6）
const query = ref('');
const filtered = computed(() => {
	const q = query.value.trim().toLowerCase();
	if (q === '') return venues.value;
	return venues.value.filter(
		(venue) => venue.code.toLowerCase().includes(q) || venue.name.toLowerCase().includes(q),
	);
});

const addOpen = ref(false);

// 会場マスタの取り込み（F-13）。提出シートの会場マスタを code を鍵に upsert する。手で足した会場は触らない
const toast = useToast();
const importing = ref(false);
async function importMaster() {
	importing.value = true;
	try {
		const result = await api<{
			inserted: number;
			updated: number;
			unchanged: number;
			skipped: number;
		}>('/venues/import', { method: 'POST' });
		toast.add({
			title: '会場マスタを取り込みました',
			description: `追加 ${result.inserted} 件・名前を直した ${result.updated} 件・変わらず ${result.unchanged} 件・自分で追加した会場 ${result.skipped} 件は触っていない`,
			color: 'success',
		});
		await refresh();
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している（認可切れなら設定へ導く）
	} finally {
		importing.value = false;
	}
}

// ルートの削除は確認を挟む。使う区間の並びだけが消え、区間そのものは残る（04-api.md 4.7）
const removing = ref<{ venue: Venue; route: VenueRoute } | null>(null);
const confirmOpen = ref(false);
const deleting = ref(false);

function askRemove(venue: Venue, route: VenueRoute) {
	removing.value = { venue, route };
	confirmOpen.value = true;
}

async function removeRoute() {
	if (!removing.value) return;
	deleting.value = true;
	try {
		await api(`/routes/${removing.value.route.id}`, { method: 'DELETE' });
		confirmOpen.value = false;
		await refresh();
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している
	} finally {
		deleting.value = false;
	}
}

function sourceLabel(venue: Venue) {
	return venue.source === 'master' ? 'マスタ由来' : '自分で追加';
}
</script>

<template>
	<div class="space-y-4">
		<!-- 追加の操作は一覧の見出しの右端に置く（3.8 と同じ流儀） -->
		<div class="flex items-center justify-between gap-2">
			<h2 class="font-semibold">会場</h2>
			<div class="flex gap-2">
				<UButton
					icon="i-lucide-download"
					variant="outline"
					color="neutral"
					:loading="importing"
					data-testid="import"
					@click="importMaster"
				>
					会場マスタを取り込む
				</UButton>
				<UButton icon="i-lucide-plus" @click="addOpen = true">会場を追加</UButton>
			</div>
		</div>

		<!-- 43ブロックが縦に積まれる。ルートを足したい会場へスクロールで辿り着かせない（3.6） -->
		<UInput
			v-model="query"
			icon="i-lucide-search"
			placeholder="会場コード・会場名で絞り込む"
			class="w-full"
			aria-label="会場の絞り込み"
		/>

		<div v-if="status === 'pending'" class="space-y-2">
			<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
		</div>

		<!-- 読み込めなかったことを「まだ会場がありません」と出さない。空と失敗は別のことである -->
		<div v-else-if="error" class="space-y-3">
			<p class="text-muted text-sm">会場の一覧を読み込めませんでした。</p>
			<UButton variant="outline" @click="refresh()">もう一度読み込む</UButton>
		</div>

		<p v-else-if="venues.length === 0" class="text-muted text-sm">
			まだ会場がありません。設定から会場マスタを取り込むか、ここで追加する。
		</p>

		<p v-else-if="filtered.length === 0" class="text-muted text-sm">
			「{{ query }}」に一致する会場はありません。
		</p>

		<ul v-else class="space-y-3">
			<li v-for="venue in filtered" :key="venue.id" data-testid="venue">
				<UCard :ui="{ body: 'p-3 sm:p-4' }">
					<template #header>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<!-- 会場マスタは会場名が空の行が多く、そのときはコードが名前になる（取り込みの仕様）。
								     名前がコードのままなら、コードを添えると同じ文字が2つ並ぶだけなので添えない -->
								<p class="font-semibold">
									<span v-if="venue.name !== venue.code" class="text-muted font-mono text-sm">{{
										venue.code
									}}</span>
									{{ venue.name }}
								</p>
								<p class="text-muted text-xs">{{ sourceLabel(venue) }}</p>
							</div>
							<!-- 0本の会場は記録できない（4.3）。目立たせる -->
							<UBadge
								v-if="venue.routes.length === 0"
								color="warning"
								variant="subtle"
								class="shrink-0"
							>
								ルートなし
							</UBadge>
							<UBadge v-else color="neutral" variant="subtle" class="shrink-0">
								{{ venue.routes.length }}本
							</UBadge>
						</div>
					</template>

					<p v-if="venue.routes.length === 0" class="text-muted text-sm">
						この会場にはルートが無く、<b>交通費を記録できない。</b>先にルートを足す。
					</p>
					<ul v-else class="divide-default divide-y">
						<li v-for="route in venue.routes" :key="route.id" class="flex items-center gap-2 py-2">
							<NuxtLink :to="`/routes/${route.id}`" class="flex min-w-0 flex-1 flex-col">
								<span class="truncate font-medium">{{ route.name }}</span>
								<span class="text-muted text-sm">
									{{ route.segmentCount }}区間 · 片道 {{ route.oneWayTotal.toLocaleString() }}円
								</span>
							</NuxtLink>
							<UButton
								icon="i-lucide-trash-2"
								variant="ghost"
								color="neutral"
								:aria-label="`${route.name}を削除`"
								@click="askRemove(venue, route)"
							/>
						</li>
					</ul>

					<template #footer>
						<UButton
							:to="`/routes/new?venueId=${venue.id}`"
							icon="i-lucide-plus"
							variant="outline"
							size="sm"
						>
							ルートを追加
						</UButton>
					</template>
				</UCard>
			</li>
		</ul>

		<VenueAddSheet v-model:open="addOpen" @changed="refresh()" />
		<ConfirmDialog
			v-model:open="confirmOpen"
			title="このルートを削除する"
			:description="`「${removing?.route.name ?? ''}」の区間の並びが消える。区間そのものと片道運賃は残る。このルートで記録した済みの交通費も動かない。`"
			confirm-label="削除する"
			:loading="deleting"
			@confirm="removeRoute"
		/>
	</div>
</template>

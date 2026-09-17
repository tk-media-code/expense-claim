<script setup lang="ts">
import type { ConfigBackup, ConfigBackupCounts } from '~/types/config-backup';
import type { GoogleAuthorization, ScopeName, Settings } from '~/types/settings';

definePageMeta({
	title: '設定',
	back: '/',
});

const api = useApi();
const toast = useToast();
const route = useRoute();

// 開いたときに叩く（04-api.md 8章）。認可の状態は保持スコープまで出す（3.11）ので、両方を読む
const settingsFetch = await useApiFetch<Settings>('/settings');
const authorizationFetch = await useApiFetch<GoogleAuthorization>('/google/authorization');
const settings = computed(() => settingsFetch.data.value ?? null);
const authorization = computed(() => authorizationFetch.data.value ?? null);

// 認可のコールバックが失敗したときの理由（バックエンドが /settings?error=… へ戻す）
const error = computed(() => {
	const value = route.query.error;
	return typeof value === 'string' && value !== '' ? value : null;
});

const SCOPE_LABELS: Record<ScopeName, string> = {
	'gmail.readonly': '依頼メールを読む',
	'gmail.send': '提出アラートを送る',
	'drive.file': '領収書を保存する',
	spreadsheets: '提出シートを読み書きする',
};

// 失効しているか、足りないスコープがあれば目立たせる（3.11）
const needsReauthorization = computed(
	() => !authorization.value?.authorized || (authorization.value?.missingScopes.length ?? 0) > 0,
);

// Google の同意画面へは SPA の中ではなく、ページごと移る
function reauthorize() {
	window.location.href = '/api/google/authorization/start';
}

const loggingOut = ref(false);
async function logout(all: boolean) {
	loggingOut.value = true;
	try {
		await api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST' });
		useAuthenticated().value = false;
		await navigateTo('/login');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している
	} finally {
		loggingOut.value = false;
	}
}

// 設定データの控え（NF-11 / 02-screens.md 3.11）。書き出しはリンクで落とし、読み込みは置き換えなので確認を挟む
const fileInput = ref<HTMLInputElement | null>(null);
const pending = ref<ConfigBackup | null>(null);
const confirmOpen = ref(false);
const importing = ref(false);

function pickFile() {
	fileInput.value?.click();
}

async function onFile(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) return;
	try {
		const parsed: unknown = JSON.parse(await file.text());
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			!('version' in parsed) ||
			parsed.version !== 1
		) {
			toast.add({
				title: '控えの version が違います。このアプリが書き出したものを選んでください',
				color: 'error',
			});
			return;
		}
		pending.value = parsed as ConfigBackup;
		confirmOpen.value = true;
	} catch {
		toast.add({ title: 'JSON として読めませんでした', color: 'error' });
	}
}

async function importBackup() {
	if (!pending.value) return;
	importing.value = true;
	try {
		const result = await api<ConfigBackupCounts>('/settings/config-backup', {
			method: 'POST',
			body: pending.value,
		});
		toast.add({
			title: '設定データを読み込みました',
			description: `駅 ${result.stations}・会場 ${result.venues}・区間 ${result.segments}・ルート ${result.routes}`,
			color: 'success',
		});
		confirmOpen.value = false;
		pending.value = null;
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している
	} finally {
		importing.value = false;
	}
}
</script>

<template>
	<div class="space-y-8">
		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="i-lucide-shield-x"
			title="再認可できませんでした"
			:description="error"
			data-testid="authorization-error"
		/>

		<!-- Google API の認可（F-02）。ログインとは別に、一度だけ取る -->
		<section class="space-y-3" data-testid="google">
			<h2 class="font-semibold">Google との連携</h2>
			<div v-if="authorizationFetch.status.value === 'pending'">
				<USkeleton class="h-16 w-full" />
			</div>
			<template v-else-if="authorization">
				<UAlert
					v-if="!authorization.authorized"
					color="error"
					variant="subtle"
					icon="i-lucide-unplug"
					title="まだ認可していません"
					description="Gmail・ドライブ・スプレッドシートを使うには、Google の認可が要る。"
				/>
				<UAlert
					v-else-if="authorization.missingScopes.length > 0"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					title="足りない権限があります"
					:description="`${authorization.missingScopes.map((s) => SCOPE_LABELS[s]).join('・')}の権限が無い。再認可すると揃う。`"
				/>
				<UAlert
					v-else
					color="success"
					variant="subtle"
					icon="i-lucide-plug-zap"
					title="認可済み"
					:description="`${authorization.authorizedAt ? formatDateTime(authorization.authorizedAt) : ''} に認可`"
				/>
				<ul class="text-sm" data-testid="scopes">
					<li
						v-for="scope in Object.keys(SCOPE_LABELS) as ScopeName[]"
						:key="scope"
						class="flex items-center gap-2 py-1"
					>
						<UIcon
							:name="authorization.scopes.includes(scope) ? 'i-lucide-check' : 'i-lucide-x'"
							:class="authorization.scopes.includes(scope) ? 'text-success' : 'text-error'"
						/>
						<span>{{ SCOPE_LABELS[scope] }}</span>
						<code class="text-muted text-xs">{{ scope }}</code>
					</li>
				</ul>
				<UButton
					icon="i-lucide-refresh-cw"
					:color="needsReauthorization ? 'primary' : 'neutral'"
					:variant="needsReauthorization ? 'solid' : 'outline'"
					block
					data-testid="reauthorize"
					@click="reauthorize"
				>
					{{ authorization.authorized ? '再認可する' : '認可する' }}
				</UButton>
			</template>
		</section>

		<!-- 提出先の確認。名前だけで、ID は出さない（N-08） -->
		<section class="space-y-2" data-testid="destination">
			<h2 class="font-semibold">提出先</h2>
			<dl v-if="settings" class="space-y-1 text-sm">
				<div class="flex gap-2">
					<dt class="text-muted w-32 shrink-0">スプレッドシート</dt>
					<dd>{{ settings.spreadsheetName ?? '（まだ読めていない）' }}</dd>
				</div>
				<div class="flex gap-2">
					<dt class="text-muted w-32 shrink-0">自分のシート</dt>
					<dd>{{ settings.sheetName ?? '（未設定）' }}</dd>
				</div>
				<div class="flex gap-2">
					<dt class="text-muted w-32 shrink-0">対象月度</dt>
					<dd>
						{{ settings.targetMonth ? formatMonth(settings.targetMonth) : '（まだ読めていない）' }}
					</dd>
				</div>
			</dl>
			<p class="text-muted text-xs">
				対象月度は提出シートの A1 が決める（決定13）。手で変える操作は無い。
			</p>
		</section>

		<!-- 設定データの控え（NF-11）。駅・会場・区間・ルートだけ。実績は含めない（N-05） -->
		<section class="space-y-2" data-testid="config-backup">
			<h2 class="font-semibold">設定データの控え</h2>
			<p class="text-muted text-sm">
				駅・会場・区間・ルートを JSON
				で書き出す。読み込みは追加ではなく置き換え。案件と交通費の記録は残る。
			</p>
			<UButton
				to="/api/settings/config-backup"
				external
				icon="i-lucide-download"
				variant="outline"
				block
				data-testid="export-config"
			>
				設定データを書き出す
			</UButton>
			<input
				ref="fileInput"
				type="file"
				accept="application/json"
				class="hidden"
				data-testid="import-config-file"
				@change="onFile"
			/>
			<UButton
				icon="i-lucide-upload"
				variant="outline"
				block
				data-testid="import-config"
				@click="pickFile"
			>
				設定データを読み込む
			</UButton>
			<ConfirmDialog
				v-model:open="confirmOpen"
				title="設定データを置き換える"
				description="今ある駅・会場・区間・ルートが、控えの内容に置き換わる。案件と交通費の記録は残る。部分的に混ぜることはできない。"
				confirm-label="置き換える"
				:loading="importing"
				@confirm="importBackup"
			/>
		</section>

		<section class="space-y-2">
			<h2 class="font-semibold">ログアウト</h2>
			<UButton
				variant="outline"
				color="neutral"
				:loading="loggingOut"
				block
				data-testid="logout"
				@click="logout(false)"
			>
				この端末からログアウト
			</UButton>
			<UButton
				variant="subtle"
				color="error"
				:loading="loggingOut"
				block
				data-testid="logout-all"
				@click="logout(true)"
			>
				すべての端末からログアウト
			</UButton>
			<p class="text-muted text-xs">
				端末をなくしたときは「すべての端末」を使う。他の端末で使っていたログインもその場で切れる（04-api.md
				4.1）。
			</p>
		</section>
	</div>
</template>

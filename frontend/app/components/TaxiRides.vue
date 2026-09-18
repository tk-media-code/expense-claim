<script setup lang="ts">
import type { TaxiRide } from '~/types/expense-record';

// 記録画面の「タクシーに乗った」（02-screens.md 3.5 / F-22〜F-26）。既定では畳んでおく。
// 乗車と領収書は「保存」にまとめず、領収書を選んだ時点で送る（04-api.md 4.6）。
// 保存に失敗したら乗車は記録されない（F-26）。中途半端な状態を作らない
const props = defineProps<{ projectId: number; taxiRides: TaxiRide[] }>();
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const open = ref(props.taxiRides.length > 0);
const amount = ref('');
const pending = ref<File | null>(null);
const uploading = ref(false);
const removing = ref<number | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const total = computed(() => props.taxiRides.reduce((sum, ride) => sum + ride.amount, 0));

async function upload(file: File) {
	uploading.value = true;
	try {
		const body = new FormData();
		body.append('amount', toHalfWidthDigits(amount.value));
		body.append('receipt', file);
		await api<TaxiRide>(`/projects/${props.projectId}/taxi-rides`, { method: 'POST', body });
		amount.value = '';
		pending.value = null;
		if (fileInput.value) fileInput.value.value = '';
		emit('changed');
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している。金額と選んだファイルは残す
	} finally {
		uploading.value = false;
	}
}

// 領収書を選んだ時点で送る。金額を確かめているあいだにアップロードが終わる（4.6）。
// 金額がまだ無ければ持っておき、「追加する」で送る
function onFile(event: Event) {
	const file = (event.target as HTMLInputElement).files?.[0] ?? null;
	pending.value = file;
	if (file && amount.value !== '') void upload(file);
}

function submit() {
	if (pending.value) void upload(pending.value);
}

async function remove(ride: TaxiRide) {
	removing.value = ride.id;
	try {
		await api(`/taxi-rides/${ride.id}`, { method: 'DELETE' });
		emit('changed');
	} catch {
		// 同上
	} finally {
		removing.value = null;
	}
}
</script>

<template>
	<div class="space-y-3" data-testid="taxi">
		<UButton
			variant="outline"
			color="neutral"
			:icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
			block
			data-testid="taxi-toggle"
			@click="open = !open"
		>
			タクシーに乗った{{
				taxiRides.length > 0 ? `（${taxiRides.length}回・${total.toLocaleString()}円）` : ''
			}}
		</UButton>

		<div v-if="open" class="space-y-3" data-testid="taxi-body">
			<ul v-if="taxiRides.length > 0" class="divide-default divide-y">
				<li
					v-for="ride in taxiRides"
					:key="ride.id"
					class="flex items-center gap-2 py-2"
					data-testid="taxi-ride"
				>
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="tabular-nums">{{ ride.amount.toLocaleString() }}円</span>
						<a
							:href="ride.receipt.driveUrl"
							target="_blank"
							rel="noopener"
							class="text-primary truncate text-sm underline"
						>
							{{ ride.receipt.fileName }}
						</a>
					</span>
					<UButton
						icon="i-lucide-x"
						variant="ghost"
						color="neutral"
						size="sm"
						:loading="removing === ride.id"
						:aria-label="`${ride.receipt.fileName}の乗車を消す`"
						@click="remove(ride)"
					/>
				</li>
			</ul>

			<!-- 1回ずつ。金額は領収書に書いてある数字を写すだけ（2.2） -->
			<div class="space-y-2">
				<UFormField label="金額（円）">
					<!-- type="number" にしない。フォーカスのある欄の上でホイールを回すと値が変わる（utils/digits.ts） -->
					<UInput
						v-model="amount"
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						class="w-full"
						placeholder="1800"
						data-testid="taxi-amount"
					/>
				</UFormField>
				<UFormField label="領収書（画像か PDF）">
					<input
						ref="fileInput"
						type="file"
						accept="image/*,application/pdf"
						class="block w-full text-sm"
						data-testid="taxi-receipt"
						@change="onFile"
					/>
				</UFormField>
				<UButton
					v-if="pending && !uploading"
					icon="i-lucide-upload"
					variant="outline"
					block
					data-testid="taxi-submit"
					@click="submit"
				>
					この金額と領収書で追加する
				</UButton>
				<p v-if="uploading" class="text-muted text-sm">領収書をドライブへ保存しています…</p>
				<p class="text-muted text-xs">
					領収書を選ぶとその場でドライブへ保存し、共有を付ける（F-24 /
					F-25）。保存できなければ乗車は記録されない（F-26）。 消してもドライブのファイルは残る。
				</p>
			</div>
		</div>
	</div>
</template>

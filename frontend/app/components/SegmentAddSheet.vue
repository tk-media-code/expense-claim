<script setup lang="ts">
import type { Segment } from '~/types/segment';
import type { Station } from '~/types/station';

// 「区間を追加」のシート（02-screens.md 3.8）。
// 画面を替えずに重ねて出す（2.1）ので URL を持たない。2-7 の「区間を登録する」からも重ねて使う。
// 新しい区間の運賃をここで入れるのは、直すのとは違う。登録したばかりの区間を使っている
// ルートはまだどこにも無く、波及する先が無い（3.8）。
defineProps<{ stations: Station[] }>();
const open = defineModel<boolean>('open', { required: true });
// 登録した区間を添えて知らせる。ルートの編集から開いたとき、そのまま並びに入れるため（3.7）
const emit = defineEmits<{ changed: [segment: Segment]; stationsChanged: [] }>();

const api = useApi();
const fromStationId = ref<number | undefined>(undefined);
const toStationId = ref<number | undefined>(undefined);
const oneWayFare = ref('');
const saving = ref(false);

// 開くたびに打ちかけを捨てる。失敗では閉じないので、捨ててよいのは開き直したときだけである。
watch(open, (isOpen) => {
	if (isOpen) {
		fromStationId.value = undefined;
		toStationId.value = undefined;
		oneWayFare.value = '';
	}
});

async function submit() {
	saving.value = true;
	try {
		// 空なら NaN のまま送り、サーバーの 422 の文面をそのまま出す。文面は画面に持たない（07-development.md 7章）
		const created = await api<Segment>('/segments', {
			method: 'POST',
			body: {
				fromStationId: fromStationId.value,
				toStationId: toStationId.value,
				oneWayFare:
					oneWayFare.value === '' ? undefined : Number(toHalfWidthDigits(oneWayFare.value)),
			},
		});
		open.value = false;
		emit('changed', created);
	} catch {
		// 失敗の文面は plugins/api.ts が既にトーストへ出している（04-api.md 2.5）。
		// ここでやるのは「閉じない」ことだけ。閉じると打った内容ごと消える。
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<USlideover v-model:open="open" side="bottom" title="区間を追加">
		<template #body>
			<form class="space-y-4" @submit.prevent="submit">
				<StationPicker
					v-model="fromStationId"
					label="出発駅"
					:stations="stations"
					@stations-changed="emit('stationsChanged')"
				/>
				<StationPicker
					v-model="toStationId"
					label="到着駅"
					:stations="stations"
					@stations-changed="emit('stationsChanged')"
				/>
				<UFormField label="片道運賃（円）">
					<!-- type="number" にしない。フォーカスのある欄の上でホイールを回すと値が変わる（utils/digits.ts） -->
					<UInput
						v-model="oneWayFare"
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						class="w-full"
						placeholder="320"
					/>
				</UFormField>
				<p class="text-muted text-sm">
					<b>「自宅→会場」の向きで登録する</b>（決定9）。復路は同じ区間を逆向きに使うので、
					逆向きの区間は登録しない。<b>前の区間の到着駅と次の区間の出発駅は一致しなくてよい。</b>
				</p>
				<UButton type="submit" :loading="saving" block>登録する</UButton>
			</form>
		</template>
	</USlideover>
</template>

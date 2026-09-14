<script setup lang="ts">
import type { ProjectFormValue } from '~/types/project';
import type { Venue } from '~/types/venue';

// 案件の4項目（02-screens.md 3.3 / 3.4）。追加と詳細の両方が使う。
// 会場は会場一覧から選ぶ。会場名はサーバーが会場コードから引くので、ここでは持たない
defineProps<{ venues: Venue[] }>();
const value = defineModel<ProjectFormValue>({ required: true });
</script>

<template>
	<div class="space-y-4">
		<UFormField label="施行日">
			<!-- 暦日は YYYY-MM-DD の文字列のまま送る（04-api.md 2.4）。type="date" がその形で返す -->
			<UInput v-model="value.serviceDate" type="date" class="w-full" aria-label="施行日" />
		</UFormField>
		<UFormField label="会場">
			<USelectMenu
				v-model="value.venueCode"
				:items="venues.map((venue) => ({ id: venue.code, label: `${venue.code} ${venue.name}` }))"
				value-key="id"
				label-key="label"
				placeholder="会場を選ぶ"
				:search-input="{ placeholder: '会場コード・会場名で探す' }"
				class="w-full"
				aria-label="会場"
			/>
		</UFormField>
		<UFormField label="ご両家名">
			<UInput
				v-model="value.coupleName"
				class="w-full"
				placeholder="〇〇様△△様"
				aria-label="ご両家名"
			/>
		</UFormField>
		<UFormField label="案件番号">
			<UInput
				v-model="value.projectNo"
				class="w-full"
				inputmode="numeric"
				placeholder="100000001"
				aria-label="案件番号"
			/>
		</UFormField>
	</div>
</template>

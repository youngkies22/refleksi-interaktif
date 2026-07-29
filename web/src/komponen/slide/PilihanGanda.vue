<script setup lang="ts">
import type { AgregatHitung, JawabanPayload, Slide } from '@bersama/tipe';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  slide: Slide;
  agregat: AgregatHitung | null;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
}>();
const emit = defineEmits<{ jawab: [payload: JawabanPayload] }>();

// Satu hue tetap per POSISI opsi (bukan per hasil) — opsi A selalu biru, opsi B
// selalu oranye, dst, konsisten sepanjang sesi walau jumlah suara berubah-ubah.
const HURUF = ['A', 'B', 'C', 'D', 'E', 'F'];
const WARNA_BAR = ['bg-blue-500', 'bg-orange-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500', 'bg-cyan-600'];
const WARNA_BADGE = [
  'bg-blue-100 text-blue-700',
  'bg-orange-100 text-orange-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

const dipilihLokal = ref<number | null>(null);
watch(() => props.slide.id, () => (dipilihLokal.value = null));

const maks = computed(() => Math.max(1, ...Object.values(props.agregat?.data ?? {})));

function persen(opsiId: number): number {
  const jumlah = props.agregat?.data[String(opsiId)] ?? 0;
  return maks.value > 0 ? Math.round((jumlah / maks.value) * 100) : 0;
}
function jumlah(opsiId: number): number {
  return props.agregat?.data[String(opsiId)] ?? 0;
}
/** Label muat di dalam bar hanya kalau bar-nya cukup lebar — kalau tidak,
 *  pindah ke luar (di sisi kanan) supaya teksnya tidak pernah terpotong. */
function labelDiDalam(opsiId: number): boolean {
  return persen(opsiId) >= 22;
}

function pilih(opsiId: number): void {
  if (dipilihLokal.value !== null) return;
  dipilihLokal.value = opsiId;
  emit('jawab', { tipe: 'pilihan_ganda', opsiId });
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="mode === 'peserta' && !sudahJawab && !terkunci">
      <button
        v-for="(o, i) in slide.opsi"
        :key="o.id"
        type="button"
        :disabled="dipilihLokal !== null"
        class="w-full flex items-center gap-3 text-left rounded-2xl border-2 border-slate-200 py-3.5 px-4 hover:border-blue-400 hover:bg-blue-50/60 active:scale-[0.99] transition-all disabled:opacity-60"
        :class="dipilihLokal === o.id ? 'border-blue-500 bg-blue-50' : ''"
        @click="pilih(o.id)"
      >
        <span class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm" :class="WARNA_BADGE[i % WARNA_BADGE.length]">
          {{ HURUF[i % HURUF.length] }}
        </span>
        <span class="text-slate-700">{{ o.teks }}</span>
      </button>
    </template>
    <p v-else-if="mode === 'peserta'" class="text-center text-slate-400">✓ Jawaban terkirim. Menunggu peserta lain...</p>

    <div v-if="mode === 'presenter' && !terkunci" class="text-center py-10">
      <p class="text-slate-400">⏳ Menunggu dikunci untuk menampilkan hasil...</p>
      <p class="text-sm text-slate-400 mt-2">{{ agregat?.total ?? 0 }} jawaban masuk</p>
    </div>
    <div v-else-if="agregat && (mode === 'presenter' || sudahJawab)" class="space-y-3 pt-1">
      <div v-for="(o, i) in slide.opsi" :key="o.id" class="flex items-center gap-2">
        <span class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs" :class="WARNA_BADGE[i % WARNA_BADGE.length]">
          {{ HURUF[i % HURUF.length] }}
        </span>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-slate-700 truncate mb-1">{{ o.teks }}</p>
          <div class="relative h-6 bg-slate-100 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500 ease-out flex items-center justify-end"
              :class="WARNA_BAR[i % WARNA_BAR.length]"
              :style="{ width: Math.max(persen(o.id), jumlah(o.id) > 0 ? 8 : 0) + '%' }"
            >
              <span v-if="labelDiDalam(o.id)" class="text-white text-xs font-semibold pr-2">{{ jumlah(o.id) }}</span>
            </div>
            <span v-if="!labelDiDalam(o.id) && jumlah(o.id) > 0" class="absolute top-0 h-full flex items-center text-xs font-semibold text-slate-500 pl-1.5" :style="{ left: Math.max(persen(o.id), 8) + '%' }">
              {{ jumlah(o.id) }}
            </span>
          </div>
        </div>
      </div>
      <p class="text-xs text-slate-400 text-right">{{ agregat.total }} jawaban</p>
    </div>
  </div>
</template>

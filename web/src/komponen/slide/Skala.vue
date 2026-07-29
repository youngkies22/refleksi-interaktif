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

const min = computed(() => props.slide.konfig.min ?? 1);
const maks = computed(() => props.slide.konfig.maks ?? 5);
const rentang = computed(() => {
  const arr: number[] = [];
  for (let n = min.value; n <= maks.value; n++) arr.push(n);
  return arr;
});

const dipilihLokal = ref<number | null>(null);
watch(() => props.slide.id, () => (dipilihLokal.value = null));

const maksJumlah = computed(() => Math.max(1, ...Object.values(props.agregat?.data ?? {})));
const rataRata = computed(() => {
  if (!props.agregat || props.agregat.total === 0) return null;
  const jumlahTertimbang = Object.entries(props.agregat.data).reduce(
    (s, [nilai, jml]) => s + Number(nilai) * jml,
    0,
  );
  return (jumlahTertimbang / props.agregat.total).toFixed(1);
});

function persen(nilai: number): number {
  const jumlah = props.agregat?.data[String(nilai)] ?? 0;
  return maksJumlah.value > 0 ? Math.round((jumlah / maksJumlah.value) * 100) : 0;
}
function jumlah(nilai: number): number {
  return props.agregat?.data[String(nilai)] ?? 0;
}

function pilih(nilai: number): void {
  if (dipilihLokal.value !== null) return;
  dipilihLokal.value = nilai;
  emit('jawab', { tipe: 'skala', nilai });
}
</script>

<template>
  <div class="space-y-5">
    <template v-if="mode === 'peserta' && !sudahJawab && !terkunci">
      <div class="flex justify-between text-xs text-slate-400 px-1 font-medium">
        <span>{{ slide.konfig.label_min || min }}</span>
        <span>{{ slide.konfig.label_maks || maks }}</span>
      </div>
      <div class="flex gap-2">
        <button
          v-for="n in rentang"
          :key="n"
          type="button"
          :disabled="dipilihLokal !== null"
          class="flex-1 aspect-square min-h-11 rounded-2xl border-2 border-slate-200 text-lg font-bold text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 active:scale-95 transition-all disabled:opacity-60"
          :class="dipilihLokal === n ? 'border-blue-500 bg-blue-500 text-white' : ''"
          @click="pilih(n)"
        >
          {{ n }}
        </button>
      </div>
    </template>
    <p v-else-if="mode === 'peserta'" class="text-center text-slate-400">✓ Jawaban terkirim. Menunggu peserta lain...</p>

    <div v-if="mode === 'presenter' && !terkunci" class="text-center py-10">
      <p class="text-slate-400">⏳ Menunggu dikunci untuk menampilkan hasil...</p>
      <p class="text-sm text-slate-400 mt-2">{{ agregat?.total ?? 0 }} jawaban masuk</p>
    </div>
    <div v-else-if="agregat && (mode === 'presenter' || sudahJawab)" class="space-y-4 pt-1">
      <div v-if="rataRata" class="text-center">
        <p class="text-4xl font-bold text-blue-700 leading-none">{{ rataRata }}</p>
        <p class="text-xs text-slate-400 mt-1">rata-rata dari {{ agregat.total }} jawaban</p>
      </div>

      <div class="space-y-2">
        <div v-for="n in rentang" :key="n" class="flex items-center gap-2">
          <span class="w-5 text-sm font-semibold text-slate-500 text-center">{{ n }}</span>
          <div class="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500 ease-out bg-blue-500"
              :style="{ width: (jumlah(n) > 0 ? Math.max(persen(n), 6) : 0) + '%' }"
            />
          </div>
          <span class="w-6 text-xs text-slate-400 text-right">{{ jumlah(n) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BarisPeringkat, JawabanPayload, Slide } from '@bersama/tipe';
import { BATAS, BATAS_DETIK_BAWAAN } from '@bersama/konstanta';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Leaderboard from '../umum/Leaderboard.vue';

const props = defineProps<{
  slide: Slide;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
  mulaiSlideAt: number | null;
  kunciTambahan: { jawabanDiterima: string[] } | null;
  leaderboard: BarisPeringkat[] | null;
  umpanBalik: { benar: boolean; poin: number; skorTotal: number; peringkat: number } | null;
}>();
const emit = defineEmits<{ jawab: [payload: JawabanPayload] }>();

const batasDetik = computed(() => props.slide.konfig.batas_detik ?? BATAS_DETIK_BAWAAN);
const sisaDetik = ref(batasDetik.value);
let timer: ReturnType<typeof setInterval> | undefined;
function tick(): void {
  if (!props.mulaiSlideAt) return;
  sisaDetik.value = Math.max(0, Math.ceil(batasDetik.value - (Date.now() - props.mulaiSlideAt) / 1000));
}
onMounted(() => { tick(); timer = setInterval(tick, 200); });
onUnmounted(() => clearInterval(timer));
watch(() => props.mulaiSlideAt, tick);

const teks = ref('');
watch(() => props.slide.id, () => (teks.value = ''));

function kirim(): void {
  if (teks.value.trim() === '' || props.sudahJawab || props.terkunci) return;
  emit('jawab', { tipe: 'ketik_jawaban', teks: teks.value });
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="!kunciTambahan" class="flex justify-center text-sm text-slate-400">⏱ {{ sisaDetik }}s</div>

    <form v-if="!kunciTambahan && !sudahJawab && !terkunci" class="space-y-3" @submit.prevent="kirim">
      <input
        v-model="teks"
        type="text"
        :maxlength="BATAS.ketikJawaban"
        placeholder="Ketik jawabanmu..."
        class="w-full rounded-xl border border-slate-300 py-3 px-4 text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button type="submit" class="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 hover:bg-blue-700">Kirim</button>
    </form>
    <p v-else-if="!kunciTambahan && mode === 'peserta'" class="text-center text-slate-400">Jawaban terkirim. Menunggu waktu habis...</p>

    <!-- Ditahan sampai `kunciTambahan` terisi (waktu habis) — lihat catatan di Kuis.vue -->
    <div
      v-if="umpanBalik && kunciTambahan"
      class="rounded-2xl p-5 text-center"
      :class="umpanBalik.benar ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'"
    >
      <p class="text-2xl font-bold" :class="umpanBalik.benar ? 'text-emerald-600' : 'text-red-500'">
        {{ umpanBalik.benar ? '✅ Benar!' : '❌ Salah' }}
      </p>
      <p class="text-slate-500 text-sm mt-1">+{{ umpanBalik.poin }} poin — total {{ umpanBalik.skorTotal }} (peringkat #{{ umpanBalik.peringkat }})</p>
    </div>

    <div v-if="kunciTambahan" class="text-center">
      <p class="text-sm text-slate-400 mb-1">Jawaban yang benar:</p>
      <p class="text-lg font-semibold text-emerald-600">{{ kunciTambahan.jawabanDiterima.join(' / ') }}</p>
    </div>

    <Leaderboard v-if="kunciTambahan && leaderboard" :top="leaderboard" />
  </div>
</template>

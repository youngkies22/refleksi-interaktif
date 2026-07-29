<script setup lang="ts">
import type { BarisPeringkat, JawabanPayload, Opsi, Slide } from '@bersama/tipe';
import { BATAS_DETIK_BAWAAN } from '@bersama/konstanta';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import Leaderboard from '../umum/Leaderboard.vue';

const props = defineProps<{
  slide: Slide;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
  mulaiSlideAt: number | null;
  hasil: { opsi: Opsi[] } | null; // opsi sudah terurut BENAR — urutan array ITU kuncinya
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

const urutanLokal = ref<Opsi[]>([]);
watch(() => props.slide.id, () => (urutanLokal.value = [...props.slide.opsi]), { immediate: true });
const terkirim = ref(false);

function kirim(): void {
  if (props.sudahJawab || props.terkunci || terkirim.value) return;
  terkirim.value = true;
  emit('jawab', { tipe: 'puzzle', urutan: urutanLokal.value.map((o) => o.id) });
}

function statusOpsi(i: number): 'benar' | 'salah' | null {
  if (!props.hasil) return null;
  return urutanLokal.value[i]?.id === props.hasil.opsi[i]?.id ? 'benar' : 'salah';
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="!hasil" class="flex justify-center text-sm text-slate-400">⏱ {{ sisaDetik }}s</div>

    <template v-if="!hasil && !sudahJawab && !terkunci && !terkirim">
      <p class="text-xs text-slate-400 text-center">Seret untuk menyusun urutan yang benar</p>
      <draggable v-model="urutanLokal" item-key="id" handle=".pegangan" class="space-y-2">
        <template #item="{ element: o, index: i }">
          <div class="flex items-center gap-2 rounded-xl border border-slate-300 pr-4 pl-1 py-1 bg-white">
            <span class="pegangan cursor-grab active:cursor-grabbing text-slate-300 select-none touch-none flex items-center justify-center w-11 h-11 text-lg shrink-0">⠿</span>
            <span class="w-5 text-sm text-slate-400 shrink-0">{{ i + 1 }}</span>
            <span class="flex-1 py-2">{{ o.teks }}</span>
          </div>
        </template>
      </draggable>
      <button type="button" class="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 hover:bg-blue-700" @click="kirim">
        Kirim Urutan
      </button>
    </template>
    <p v-else-if="!hasil && mode === 'peserta'" class="text-center text-slate-400">Urutan terkirim. Menunggu waktu habis...</p>

    <!-- Ditahan sampai `hasil` terisi (waktu habis) — lihat catatan di Kuis.vue -->
    <div
      v-if="umpanBalik && hasil"
      class="rounded-2xl p-5 text-center"
      :class="umpanBalik.benar ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'"
    >
      <p class="text-2xl font-bold" :class="umpanBalik.benar ? 'text-emerald-600' : 'text-amber-600'">
        {{ umpanBalik.benar ? '✅ Urutan sempurna!' : '➗ Sebagian benar' }}
      </p>
      <p class="text-slate-500 text-sm mt-1">+{{ umpanBalik.poin }} poin — total {{ umpanBalik.skorTotal }} (peringkat #{{ umpanBalik.peringkat }})</p>
    </div>

    <!-- Reveal: urutan yang peserta susun, ditandai per-posisi benar/salah -->
    <div v-if="hasil" class="space-y-2">
      <p class="text-xs text-slate-400 text-center">Urutan yang benar</p>
      <div
        v-for="(o, i) in hasil.opsi"
        :key="o.id"
        class="flex items-center gap-3 rounded-xl border-2 py-3 px-4"
        :class="statusOpsi(i) === 'benar' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'"
      >
        <span class="w-6 text-sm font-bold text-blue-600">#{{ i + 1 }}</span>
        <span class="flex-1">{{ o.teks }}</span>
      </div>
    </div>

    <Leaderboard v-if="hasil && leaderboard" :top="leaderboard" />
  </div>
</template>

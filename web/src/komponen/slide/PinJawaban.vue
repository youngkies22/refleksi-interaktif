<script setup lang="ts">
import type { BarisPeringkat, JawabanPayload, Slide } from '@bersama/tipe';
import { BATAS_DETIK_BAWAAN } from '@bersama/konstanta';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Leaderboard from '../umum/Leaderboard.vue';

interface KunciPin {
  areaBenar: { bentuk: 'kotak' | 'lingkaran'; x: number; y: number; w: number; h: number };
  titik: { x: number; y: number; benar: boolean }[];
}

const props = defineProps<{
  slide: Slide;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
  mulaiSlideAt: number | null;
  kunciTambahan: KunciPin | null;
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

const titikSaya = ref<{ x: number; y: number } | null>(null);
watch(() => props.slide.id, () => (titikSaya.value = null));

function tap(e: MouseEvent): void {
  if (props.sudahJawab || props.terkunci || titikSaya.value) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  titikSaya.value = { x, y };
  emit('jawab', { tipe: 'pin_jawaban', x, y });
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="!kunciTambahan" class="flex justify-center text-sm text-slate-400">⏱ {{ sisaDetik }}s</div>

    <div v-if="!slide.konfig.gambar_path" class="text-center text-slate-400 text-sm">Guru belum mengunggah gambar untuk soal ini.</div>

    <div v-else class="relative inline-block select-none touch-none w-full" :class="!sudahJawab && !terkunci && !kunciTambahan ? 'cursor-crosshair' : ''" @click="tap">
      <img :src="slide.konfig.gambar_path" class="w-full block rounded-lg" draggable="false" />

      <!-- Titik peserta sendiri, sebelum reveal — cincin animate-ping memberi
           konfirmasi visual langsung bahwa tap-nya kena, bukan cuma titik diam. -->
      <div
        v-if="titikSaya && !kunciTambahan"
        class="absolute -translate-x-1/2 -translate-y-1/2"
        :style="{ left: titikSaya.x * 100 + '%', top: titikSaya.y * 100 + '%' }"
      >
        <span class="absolute inset-0 w-4 h-4 rounded-full bg-blue-400 animate-ping"></span>
        <span class="relative block w-4 h-4 rounded-full bg-blue-500 border-2 border-white"></span>
      </div>

      <!-- Reveal: area benar + heatmap semua titik -->
      <template v-if="kunciTambahan">
        <div
          class="absolute border-2 border-emerald-400 bg-emerald-400/20"
          :style="{
            left: kunciTambahan.areaBenar.x * 100 + '%',
            top: kunciTambahan.areaBenar.y * 100 + '%',
            width: kunciTambahan.areaBenar.w * 100 + '%',
            height: kunciTambahan.areaBenar.h * 100 + '%',
            borderRadius: kunciTambahan.areaBenar.bentuk === 'lingkaran' ? '50%' : '0',
          }"
        />
        <div
          v-for="(t, i) in kunciTambahan.titik"
          :key="i"
          class="absolute w-3 h-3 rounded-full border border-white -translate-x-1/2 -translate-y-1/2"
          :class="t.benar ? 'bg-emerald-500' : 'bg-red-500'"
          :style="{ left: t.x * 100 + '%', top: t.y * 100 + '%' }"
        />
      </template>
    </div>

    <p v-if="!kunciTambahan && titikSaya && mode === 'peserta'" class="text-center text-slate-400">Jawaban terkirim. Menunggu waktu habis...</p>

    <!-- Ditahan sampai `kunciTambahan` terisi (waktu habis) — lihat catatan di Kuis.vue -->
    <div
      v-if="umpanBalik && kunciTambahan"
      class="rounded-2xl p-5 text-center"
      :class="umpanBalik.benar ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'"
    >
      <p class="text-2xl font-bold" :class="umpanBalik.benar ? 'text-emerald-600' : 'text-red-500'">
        {{ umpanBalik.benar ? '✅ Tepat!' : '❌ Kurang tepat' }}
      </p>
      <p class="text-slate-500 text-sm mt-1">+{{ umpanBalik.poin }} poin — total {{ umpanBalik.skorTotal }} (peringkat #{{ umpanBalik.peringkat }})</p>
    </div>

    <Leaderboard v-if="kunciTambahan && leaderboard" :top="leaderboard" />
  </div>
</template>

<script setup lang="ts">
/**
 * Dipakai untuk DUA tipe: `kuis` dan `benar_salah`. Keduanya berbentuk sama
 * (pilih satu dari beberapa opsi, berpoin, bertimer) — bedanya cuma tata letak
 * tombol (benar_salah selalu 2 opsi besar, kuis bisa 2-4 dalam grid). Daripada
 * menduplikasi logika timer/reveal/skor di dua file, satu komponen menangani
 * keduanya dan tata letak menyesuaikan otomatis lewat jumlah opsi.
 */
import type { BarisPeringkat, JawabanPayload, Opsi, Slide } from '@bersama/tipe';
import { BATAS_DETIK_BAWAAN } from '@bersama/konstanta';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Leaderboard from '../umum/Leaderboard.vue';

const props = defineProps<{
  slide: Slide;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
  mulaiSlideAt: number | null;
  hasil: { opsi: Opsi[]; sebaran?: Record<string, number> } | null;
  leaderboard: BarisPeringkat[] | null;
  umpanBalik: { benar: boolean; poin: number; skorTotal: number; peringkat: number } | null;
}>();
const emit = defineEmits<{ jawab: [payload: JawabanPayload] }>();

const WARNA = ['bg-red-500', 'bg-blue-500', 'bg-amber-500', 'bg-emerald-500'];

const batasDetik = computed(() => props.slide.konfig.batas_detik ?? BATAS_DETIK_BAWAAN);
const sisaDetik = ref(batasDetik.value);
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  if (!props.mulaiSlideAt) {
    sisaDetik.value = batasDetik.value;
    return;
  }
  const berlalu = (Date.now() - props.mulaiSlideAt) / 1000;
  sisaDetik.value = Math.max(0, Math.ceil(batasDetik.value - berlalu));
}

onMounted(() => {
  tick();
  timer = setInterval(tick, 200);
});
onUnmounted(() => clearInterval(timer));
watch(() => props.mulaiSlideAt, tick);

const KELILING = 2 * Math.PI * 28;
const offsetRing = computed(() => KELILING * (1 - sisaDetik.value / batasDetik.value));

const dipilihLokal = ref<number | null>(null);
watch(() => props.slide.id, () => (dipilihLokal.value = null));

function opsiBenarId(): number | null {
  return props.hasil?.opsi.find((o) => o.benar)?.id ?? null;
}

function jumlahPemilih(opsiId: number): number {
  return props.hasil?.sebaran?.[String(opsiId)] ?? 0;
}
const totalPemilih = computed(() =>
  Object.values(props.hasil?.sebaran ?? {}).reduce((s, n) => s + n, 0),
);
/** Lebar bar relatif terhadap opsi TERPOPULER, bukan terhadap total — supaya
 *  perbedaan antar opsi tetap terbaca walau semua suara terkumpul di satu opsi. */
function persenPemilih(opsiId: number): number {
  const maks = Math.max(1, ...Object.values(props.hasil?.sebaran ?? {}));
  return Math.round((jumlahPemilih(opsiId) / maks) * 100);
}

function pilih(opsiId: number): void {
  if (props.sudahJawab || props.terkunci || dipilihLokal.value !== null) return;
  dipilihLokal.value = opsiId;
  emit('jawab', { tipe: props.slide.tipe as 'kuis' | 'benar_salah', opsiId });
}
</script>

<template>
  <div class="space-y-6">
    <!-- Cincin timer -->
    <div v-if="!hasil" class="flex justify-center">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" class="text-slate-200" stroke-width="5" />
        <circle
          cx="32" cy="32" r="28" fill="none" stroke="currentColor"
          class="text-blue-500 transition-all duration-200"
          stroke-width="5" stroke-linecap="round"
          :stroke-dasharray="KELILING"
          :stroke-dashoffset="offsetRing"
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="37" text-anchor="middle" class="fill-slate-700 font-bold text-lg">{{ sisaDetik }}</text>
      </svg>
    </div>

    <!-- Grid opsi -->
    <div
      v-if="!hasil"
      class="grid gap-3"
      :class="slide.opsi.length <= 2 ? 'grid-cols-1' : 'grid-cols-2'"
    >
      <button
        v-for="(o, i) in slide.opsi"
        :key="o.id"
        type="button"
        :disabled="sudahJawab || terkunci || dipilihLokal !== null"
        class="rounded-2xl text-white font-semibold py-6 px-4 transition-transform disabled:opacity-60"
        :class="[WARNA[i % WARNA.length], dipilihLokal === o.id ? 'ring-4 ring-white scale-95' : 'hover:scale-[1.02] active:scale-95']"
        @click="pilih(o.id)"
      >
        {{ o.teks }}
      </button>
    </div>
    <p v-if="!hasil && (sudahJawab || dipilihLokal !== null) && mode === 'peserta'" class="text-center text-slate-400">
      Jawaban terkirim. Menunggu waktu habis...
    </p>

    <!-- Umpan balik pribadi (peserta) — sengaja ditahan sampai `hasil` terisi
         (waktu habis / guru mengunci), BUKAN langsung saat menjawab. Kalau
         tidak, peserta yang jawab duluan akan lihat benar/salah + poin sendiri
         sebelum peserta lain sempat menjawab, membocorkan info yang seharusnya
         baru terbuka serentak saat reveal (dan bertentangan dengan pesan
         "Menunggu waktu habis..." di atas). -->
    <div
      v-if="umpanBalik && hasil"
      class="rounded-2xl p-5 text-center"
      :class="umpanBalik.benar ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'"
    >
      <p class="text-2xl font-bold" :class="umpanBalik.benar ? 'text-emerald-600' : 'text-red-500'">
        {{ umpanBalik.benar ? '✅ Benar!' : '❌ Salah' }}
      </p>
      <p class="text-slate-500 text-sm mt-1">+{{ umpanBalik.poin }} poin — total {{ umpanBalik.skorTotal }} (peringkat #{{ umpanBalik.peringkat }})</p>
    </div>

    <!-- Reveal: opsi benar disorot + sebaran jawaban kelas -->
    <div v-if="hasil" class="space-y-3">
      <div class="grid gap-3" :class="slide.opsi.length <= 2 ? 'grid-cols-1' : 'grid-cols-2'">
        <div
          v-for="o in hasil.opsi"
          :key="o.id"
          class="rounded-2xl py-5 px-4 font-semibold text-center border-2"
          :class="o.id === opsiBenarId() ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-400'"
        >
          {{ o.teks }} <span v-if="o.id === opsiBenarId()">✓</span>
        </div>
      </div>

      <div v-if="hasil.sebaran" class="space-y-2 pt-1">
        <p class="text-xs text-slate-400 text-center">Sebaran jawaban kelas</p>
        <div v-for="o in hasil.opsi" :key="o.id" class="flex items-center gap-2">
          <span class="flex-1 min-w-0 truncate text-sm" :class="o.id === opsiBenarId() ? 'text-emerald-700 font-medium' : 'text-slate-500'">
            {{ o.teks }}
          </span>
          <div class="w-32 sm:w-48 h-4 bg-slate-100 rounded-full overflow-hidden shrink-0">
            <div
              class="h-full rounded-full transition-all duration-500 ease-out"
              :class="o.id === opsiBenarId() ? 'bg-emerald-500' : 'bg-slate-300'"
              :style="{ width: (jumlahPemilih(o.id) > 0 ? Math.max(persenPemilih(o.id), 6) : 0) + '%' }"
            />
          </div>
          <span class="w-6 text-right text-xs text-slate-400 shrink-0">{{ jumlahPemilih(o.id) }}</span>
        </div>
        <p class="text-xs text-slate-400 text-right">{{ totalPemilih }} jawaban</p>
      </div>
    </div>

    <!-- Leaderboard, tampil setelah reveal -->
    <Leaderboard v-if="hasil && leaderboard" :top="leaderboard" />
  </div>
</template>

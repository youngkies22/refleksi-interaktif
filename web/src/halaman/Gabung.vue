<script setup lang="ts">
import type { AgregatSlide, BarisPeringkat, KondisiSesi, JawabanPayload, Opsi, TipeMenti, TipeSlide } from '@bersama/tipe';
import { slideBerpoin } from '@bersama/tipe';
import type { Component } from 'vue';
import { BATAS } from '@bersama/konstanta';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ambilTokenTersimpan, hapusTokenTersimpan, simpanToken } from '../composables/usePeserta.js';
import { useSocket } from '../composables/useSocket.js';
import { KOMPONEN_KAHOOT_AKTIF, KOMPONEN_MENTI } from '../komponen/slide/index.js';
import { META_TIPE } from '../komponen/slide/metaTipe.js';
import Podium from '../komponen/umum/Podium.vue';
import TombolKembali from '../komponen/umum/TombolKembali.vue';

interface UmpanBalik {
  slideId: number;
  benar: boolean;
  poin: number;
  skorTotal: number;
  peringkat: number;
}

const route = useRoute();
const router = useRouter();
const kode = String(route.params.kode).toUpperCase();
const socket = useSocket();

/** Berapa detik lagi peserta diarahkan otomatis kembali ke halaman input kode
 *  setelah guru menyelesaikan sesi — cukup lama untuk sempat melihat podium. */
const HITUNG_MUNDUR_KELUAR_DETIK = 6;
const sisaHitungMundur = ref(HITUNG_MUNDUR_KELUAR_DETIK);

const nama = ref('');
const sudahJoin = ref(false);
const menghubungkan = ref(false);
const galat = ref('');
const kondisi = ref<KondisiSesi | null>(null);
const selesai = ref(false);
const agregat = ref<AgregatSlide | null>(null);
const sudahJawabLokal = ref(false);
const mengirim = ref(false);
const hasilKuis = ref<{ opsi: Opsi[]; sebaran?: Record<string, number> } | null>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kunciTambahan = ref<any>(null); // bentuknya beda per tipe — lihat catatan di PresenterSesi.vue
const leaderboard = ref<BarisPeringkat[] | null>(null);
const umpanBalik = ref<UmpanBalik | null>(null);
const podium = ref<BarisPeringkat[] | null>(null);
/** Naik saat guru reset jawaban slide aktif — dipakai di `:key` supaya komponen
 *  slide remount total (pilihan yang sudah diklik peserta ikut bersih). */
const resetCounter = ref(0);

const slideAdalahMenti = computed(
  () => !!kondisi.value?.slide && !slideBerpoin(kondisi.value.slide.tipe),
);
const slideAdalahKahootAktif = computed(
  () => !!kondisi.value?.slide && kondisi.value.slide.tipe in KOMPONEN_KAHOOT_AKTIF,
);
const sudahJawabEfektif = computed(() => sudahJawabLokal.value || kondisi.value?.sudahJawab === true);

function metaTipeDari(tipe: TipeSlide) {
  return META_TIPE[tipe];
}
function komponenMenti(tipe: TipeSlide): Component {
  return KOMPONEN_MENTI[tipe as TipeMenti];
}
function komponenKahoot(tipe: TipeSlide): Component {
  return KOMPONEN_KAHOOT_AKTIF[tipe]!;
}

// Slide baru aktif → reset tampilan lokal (milik slide SEBELUMNYA).
watch(
  () => kondisi.value?.slide?.id,
  () => {
    agregat.value = null;
    sudahJawabLokal.value = false;
    hasilKuis.value = null;
    kunciTambahan.value = null;
    leaderboard.value = null;
    umpanBalik.value = null;
  },
);

function onKondisi(k: KondisiSesi): void {
  if (kondisi.value === null || k.sesiId === kondisi.value.sesiId) kondisi.value = k;
}
function onAgg(d: { slideId: number; agregat: AgregatSlide }): void {
  if (d.slideId === kondisi.value?.slide?.id) agregat.value = d.agregat;
}
function onHasilKuis(d: { slideId: number; opsi: Opsi[]; kunciTambahan?: unknown; sebaran?: Record<string, number> }): void {
  if (d.slideId === kondisi.value?.slide?.id) {
    hasilKuis.value = { opsi: d.opsi, sebaran: d.sebaran };
    kunciTambahan.value = d.kunciTambahan ?? null;
  }
}
function onLeaderboard(d: { slideId: number; top: BarisPeringkat[] }): void {
  if (d.slideId === kondisi.value?.slide?.id) leaderboard.value = d.top;
}
function onUmpanBalik(d: UmpanBalik): void {
  if (d.slideId === kondisi.value?.slide?.id) umpanBalik.value = d;
}
function onPodium(d: { top: BarisPeringkat[] }): void {
  podium.value = d.top;
}
function onReset(d: { slideId: number }): void {
  if (d.slideId !== kondisi.value?.slide?.id) return;
  agregat.value = null;
  sudahJawabLokal.value = false;
  hasilKuis.value = null;
  kunciTambahan.value = null;
  leaderboard.value = null;
  umpanBalik.value = null;
  resetCounter.value++;
}
function onSelesai(): void {
  selesai.value = true;
  hapusTokenTersimpan(kode); // token sesi yang sudah selesai tidak berguna lagi

  sisaHitungMundur.value = HITUNG_MUNDUR_KELUAR_DETIK;
  const interval = setInterval(() => {
    sisaHitungMundur.value -= 1;
    if (sisaHitungMundur.value <= 0) {
      clearInterval(interval);
      void router.push('/');
    }
  }, 1000);
}

async function gabung(): Promise<void> {
  galat.value = '';
  menghubungkan.value = true;
  const tokenLama = ambilTokenTersimpan(kode);

  socket.emit('peserta:join', { kode, nama: nama.value, token: tokenLama }, (b) => {
    menghubungkan.value = false;
    if (!b.ok) {
      galat.value = b.galat.pesan;
      return;
    }
    simpanToken(kode, b.data.token);
    kondisi.value = b.data.kondisi;
    sudahJoin.value = true;
  });
}

function kirimJawaban(payload: JawabanPayload): void {
  if (!kondisi.value?.slide || mengirim.value) return;
  mengirim.value = true;
  galat.value = '';
  socket.emit('peserta:jawab', { slideId: kondisi.value.slide.id, payload }, (b) => {
    mengirim.value = false;
    if (b.ok) sudahJawabLokal.value = true;
    else galat.value = b.galat.pesan;
  });
}

onMounted(() => {
  socket.on('sesi:kondisi', onKondisi);
  socket.on('agg:update', onAgg);
  socket.on('kuis:hasil', onHasilKuis);
  socket.on('kuis:leaderboard', onLeaderboard);
  socket.on('kuis:umpan_balik', onUmpanBalik);
  socket.on('kuis:podium', onPodium);
  socket.on('sesi:reset', onReset);
  socket.on('sesi:selesai', onSelesai);

  const tokenLama = ambilTokenTersimpan(kode);
  if (tokenLama) void gabung();

  const interval = setInterval(() => socket.emit('peserta:ping'), 15_000);
  onUnmounted(() => clearInterval(interval));
});

onUnmounted(() => {
  socket.off('sesi:kondisi', onKondisi);
  socket.off('agg:update', onAgg);
  socket.off('kuis:hasil', onHasilKuis);
  socket.off('kuis:leaderboard', onLeaderboard);
  socket.off('kuis:umpan_balik', onUmpanBalik);
  socket.off('kuis:podium', onPodium);
  socket.off('sesi:reset', onReset);
  socket.off('sesi:selesai', onSelesai);
});
</script>

<template>
  <main class="min-h-screen bg-slate-50 flex items-center justify-center px-4 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
    <!-- Form nama, sebelum join -->
    <form v-if="!sudahJoin" class="w-full max-w-sm text-center" @submit.prevent="gabung">
      <p class="text-slate-400 text-sm mb-1">Kode: {{ kode }}</p>
      <h1 class="text-xl font-bold text-slate-800 mb-6">Masukkan namamu</h1>
      <input
        v-model="nama"
        type="text"
        :maxlength="BATAS.nama"
        placeholder="Nama (boleh dikosongkan)"
        class="w-full rounded-xl border border-slate-300 py-3 px-4 text-center mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <p v-if="galat" class="text-sm text-red-600 mb-3">{{ galat }}</p>
      <button
        type="submit"
        :disabled="menghubungkan"
        class="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 hover:bg-blue-700 disabled:opacity-50"
      >
        {{ menghubungkan ? 'Menghubungkan...' : 'Gabung' }}
      </button>
    </form>

    <!-- Sesi selesai -->
    <div v-else-if="selesai" class="text-center">
      <p class="text-xl font-semibold text-slate-700">Sesi sudah selesai</p>
      <Podium v-if="podium && podium.length > 0" :top="podium" />
      <p class="text-slate-400 mt-1">Terima kasih sudah berpartisipasi!</p>
      <p class="text-xs text-slate-400 mt-4">Kembali ke halaman kode dalam {{ sisaHitungMundur }} detik...</p>
      <TombolKembali to="/" class="inline-flex mt-2 text-blue-600 hover:bg-blue-50" title="Kembali ke halaman awal" />
    </div>

    <!-- Menunggu / menampilkan pertanyaan aktif -->
    <div v-else class="w-full max-w-md">
      <template v-if="!kondisi?.slide">
        <p class="text-slate-400 text-center">Menunggu guru membuka pertanyaan...</p>
      </template>
      <template v-else>
        <p class="text-sm text-slate-400 mb-2 text-center">{{ metaTipeDari(kondisi.slide.tipe).ikon }} {{ metaTipeDari(kondisi.slide.tipe).label }}</p>
        <h1 class="text-xl font-bold text-slate-800 mb-4 text-center">{{ kondisi.slide.pertanyaan }}</h1>

        <p v-if="galat" class="text-sm text-red-600 mb-3 text-center">{{ galat }}</p>

        <component
          :is="komponenMenti(kondisi.slide.tipe)"
          v-if="slideAdalahMenti"
          :key="`${kondisi.slide.id}-${resetCounter}`"
          :slide="kondisi.slide"
          :agregat="agregat"
          mode="peserta"
          :terkunci="!kondisi.dibuka"
          :sudah-jawab="sudahJawabEfektif"
          @jawab="kirimJawaban"
        />
        <component
          :is="komponenKahoot(kondisi.slide.tipe)"
          v-else-if="slideAdalahKahootAktif"
          :key="`${kondisi.slide.id}-${resetCounter}`"
          :slide="kondisi.slide"
          mode="peserta"
          :terkunci="!kondisi.dibuka"
          :sudah-jawab="sudahJawabEfektif"
          :mulai-slide-at="kondisi.mulaiSlideAt"
          :hasil="hasilKuis"
          :kunci-tambahan="kunciTambahan"
          :leaderboard="leaderboard"
          :umpan-balik="umpanBalik"
          @jawab="kirimJawaban"
        />
        <p v-else class="text-sm text-slate-400 text-center">Tipe soal ini akan aktif di fase berikutnya.</p>
      </template>
    </div>
  </main>
</template>

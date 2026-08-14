<script setup lang="ts">
import type { AgregatSlide, BarisPeringkat, KondisiSesi, Opsi, Slide, TipeMenti, TipeSlide } from '@bersama/tipe';
import { slideBerpoin } from '@bersama/tipe';
import QrcodeVue from 'qrcode.vue';
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue';
import { useRoute } from 'vue-router';
import { apiPresentasi } from '../api/presentasi.js';
import { apiSesi } from '../api/sesi.js';
import { GalatApi } from '../api/klien.js';
import { useSocket } from '../composables/useSocket.js';
import { KOMPONEN_KAHOOT_AKTIF, KOMPONEN_MENTI } from '../komponen/slide/index.js';
import { META_TIPE } from '../komponen/slide/metaTipe.js';
import Podium from '../komponen/umum/Podium.vue';
import TombolKembali from '../komponen/umum/TombolKembali.vue';
import { usePengaturanStore } from '../stores/pengaturan.js';

const route = useRoute();
const kode = String(route.params.kode);
const socket = useSocket();
const pengaturan = usePengaturanStore();

const memuat = ref(true);
const galat = ref('');
const sesiId = ref<number | null>(null);
const kondisi = ref<KondisiSesi | null>(null);
const daftarSlideRingkas = ref<Pick<Slide, 'id' | 'tipe' | 'pertanyaan'>[]>([]);
const pesertaOnline = ref(0);
const pesertaTotal = ref(0);
const daftarPeserta = ref<{ nama: string }[]>([]);
const selesai = ref(false);
const agregat = ref<AgregatSlide | null>(null);
const hasilKuis = ref<{ opsi: Opsi[]; sebaran?: Record<string, number> } | null>(null);
// Bentuknya beda per tipe (ketik_jawaban/pin_jawaban) — lihat komentar di
// siarkanHasilKuis (backend). `any` di sini sengaja: satu titik serah-terima
// yang memang heterogen, bukan area kode yang longgar tipenya secara luas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kunciTambahan = ref<any>(null);
const leaderboard = ref<BarisPeringkat[] | null>(null);
const podium = ref<BarisPeringkat[] | null>(null);
const urlGabung = `${location.origin}/gabung/${kode}`;
/** Naik tiap kali slide aktif direset — dipakai di `:key` supaya komponen slide
 *  remount total (semua state lokalnya, seperti pilihan peserta, ikut bersih). */
const resetCounter = ref(0);

const slideAdalahMenti = computed(() => !!kondisi.value?.slide && !slideBerpoin(kondisi.value.slide.tipe));
const slideAdalahKahootAktif = computed(
  () => !!kondisi.value?.slide && kondisi.value.slide.tipe in KOMPONEN_KAHOOT_AKTIF,
);

const indexAktif = computed(() =>
  daftarSlideRingkas.value.findIndex((s) => s.id === kondisi.value?.slide?.id),
);
const adaSebelumnya = computed(() => indexAktif.value > 0);
const adaBerikutnya = computed(
  () => indexAktif.value >= 0 && indexAktif.value < daftarSlideRingkas.value.length - 1,
);

function metaTipeDari(tipe: TipeSlide) {
  return META_TIPE[tipe];
}
function komponenMenti(tipe: TipeSlide): Component {
  return KOMPONEN_MENTI[tipe as TipeMenti];
}
function komponenKahoot(tipe: TipeSlide): Component {
  return KOMPONEN_KAHOOT_AKTIF[tipe]!;
}

async function mulai(): Promise<void> {
  try {
    const r = await apiSesi.olehKode(kode);
    sesiId.value = r.sesiId;

    const detail = await apiPresentasi.detail(r.presentasiId);
    daftarSlideRingkas.value = detail.presentasi.slide.map((s) => ({
      id: s.id,
      tipe: s.tipe,
      pertanyaan: s.pertanyaan,
    }));

    socket.emit('presenter:buka', { sesiId: r.sesiId }, (b) => {
      if (b.ok) {
        kondisi.value = b.data.kondisi;
      } else {
        galat.value = b.galat.pesan;
      }
      memuat.value = false;
    });
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal membuka sesi.';
    memuat.value = false;
  }
}

function pindah(delta: number): void {
  const target = daftarSlideRingkas.value[indexAktif.value + delta];
  if (!target || !sesiId.value) return;
  socket.emit('presenter:slide', { slideId: target.id }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}

function kunci(dibuka: boolean): void {
  if (!kondisi.value?.slide || !sesiId.value) return;
  socket.emit('presenter:kunci', { slideId: kondisi.value.slide.id, dibuka }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}
function toggleKunci(): void {
  if (!kondisi.value) return;
  kunci(!kondisi.value.dibuka);
}

function sembunyikanJawaban(jawabanId: number): void {
  socket.emit('presenter:sembunyikan', { jawabanId }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}

function resetJawaban(): void {
  if (!kondisi.value?.slide) return;
  if (!confirm('Hapus semua jawaban untuk pertanyaan ini dan mulai ulang dari nol? Tindakan tidak bisa dibatalkan.')) return;
  socket.emit('presenter:reset', { slideId: kondisi.value.slide.id }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}

function selesaikanSesi(): void {
  if (!confirm('Selesaikan sesi ini? Peserta tidak bisa menjawab lagi setelahnya.')) return;
  socket.emit('presenter:selesai', (b) => {
    if (b.ok) selesai.value = true;
    else galat.value = b.galat.pesan;
  });
}

function onKondisi(k: KondisiSesi): void {
  if (k.sesiId === sesiId.value) {
    const slideBerubah = k.slide?.id !== kondisi.value?.slide?.id;
    kondisi.value = k;
    // `agregat` HANYA direset saat slide-nya sendiri berganti — bukan setiap
    // `sesi:kondisi` masuk. Event ini juga terkirim saat guru mengunci/membuka
    // jawaban (slide sama, cuma status kunci berubah); kalau agregat ikut
    // dikosongkan di sini, data word cloud/pilihan ganda yang sudah terkumpul
    // hilang dari layar tepat saat dikunci, padahal untuk slide Menti tidak ada
    // broadcast baru yang mengisinya lagi (beda dengan Kahoot yang punya
    // `siarkanHasilKuis` sebagai pemicu ulang).
    if (slideBerubah) {
      agregat.value = null;
      hasilKuis.value = null;
      kunciTambahan.value = null;
      leaderboard.value = null;
    }
  }
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
function onPodium(d: { top: BarisPeringkat[] }): void {
  podium.value = d.top;
}
function onReset(d: { slideId: number }): void {
  if (d.slideId !== kondisi.value?.slide?.id) return;
  agregat.value = null;
  hasilKuis.value = null;
  kunciTambahan.value = null;
  leaderboard.value = null;
  resetCounter.value++;
}
function onJumlah(d: { online: number; total: number; daftar?: { nama: string }[] }): void {
  pesertaOnline.value = d.online;
  pesertaTotal.value = d.total;
  if (d.daftar) daftarPeserta.value = d.daftar;
}
function onSelesai(d: { sesiId: number }): void {
  if (d.sesiId === sesiId.value) selesai.value = true;
}

// Kalau waktu timer di sisi presenter habis, kunci otomatis (memicu reveal di
// server) — presenter tidak perlu ingat mengklik manual tepat saat waktu 0.
// Timer sesungguhnya tetap milik server (mulaiSlideAt); ini hanya PEMICU aksi.
let pengecekWaktu: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  pengecekWaktu = setInterval(() => {
    const s = kondisi.value?.slide;
    if (!s || !kondisi.value?.dibuka || !kondisi.value?.mulaiSlideAt) return;
    if (!slideBerpoin(s.tipe)) return;
    const batasMs = (s.konfig.batas_detik ?? 20) * 1000;
    if (Date.now() - kondisi.value.mulaiSlideAt >= batasMs) kunci(false);
  }, 500);
});
onUnmounted(() => clearInterval(pengecekWaktu));

onMounted(() => {
  socket.on('sesi:kondisi', onKondisi);
  socket.on('agg:update', onAgg);
  socket.on('kuis:hasil', onHasilKuis);
  socket.on('kuis:leaderboard', onLeaderboard);
  socket.on('kuis:podium', onPodium);
  socket.on('sesi:reset', onReset);
  socket.on('peserta:jumlah', onJumlah);
  socket.on('sesi:selesai', onSelesai);
  void mulai();
});

onUnmounted(() => {
  socket.off('sesi:kondisi', onKondisi);
  socket.off('agg:update', onAgg);
  socket.off('kuis:hasil', onHasilKuis);
  socket.off('kuis:leaderboard', onLeaderboard);
  socket.off('kuis:podium', onPodium);
  socket.off('sesi:reset', onReset);
  socket.off('peserta:jumlah', onJumlah);
  socket.off('sesi:selesai', onSelesai);
});
</script>

<template>
  <div class="min-h-screen flex flex-col text-white" style="background: radial-gradient(circle at top, #1e293b 0%, #0f172a 65%);">
    <!-- Header: kode SELALU besar & terbaca dari jarak jauh, bahkan saat slide aktif -->
    <header class="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 bg-slate-900/70 backdrop-blur border-b border-white/10">
      <div class="flex items-center gap-3">
        <span class="text-[10px] sm:text-xs uppercase tracking-widest text-slate-400 font-medium">Kode</span>
        <span class="font-mono font-black text-2xl sm:text-4xl tracking-[0.15em] text-white leading-none">{{ kode }}</span>
      </div>

      <div class="flex items-center gap-2 sm:gap-4">
        <span class="hidden sm:flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          {{ pesertaOnline }} online <span class="text-slate-400">· {{ pesertaTotal }} total</span>
        </span>
        <RouterLink
          :to="`/sesi/${kode}/kontrol`"
          target="_blank"
          class="rounded-full bg-white/10 hover:bg-white/20 p-2 sm:px-3 sm:py-1.5 text-sm transition-colors"
          title="Kontrol dari HP"
        >
          📱<span class="hidden sm:inline ml-1">Kontrol HP</span>
        </RouterLink>
        <button
          class="rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-200 p-2 sm:px-3 sm:py-1.5 text-sm transition-colors"
          @click="selesaikanSesi"
        >
          ⏹<span class="hidden sm:inline ml-1">Selesaikan</span>
        </button>
      </div>
    </header>

    <main class="flex-1 flex items-center justify-center p-4 sm:p-8">
      <p v-if="memuat" class="text-slate-400 animate-pulse">Membuka sesi...</p>
      <p v-else-if="galat" class="text-red-300">{{ galat }}</p>

      <!-- Sesi selesai -->
      <div v-else-if="selesai" class="text-center max-w-md">
        <p class="text-3xl font-bold mb-2">🎉 Sesi selesai</p>
        <p class="text-slate-400 mb-6">Terima kasih sudah mengajar bersama {{ pengaturan.namaAplikasi }}!</p>
        <Podium v-if="podium && podium.length > 0" :top="podium" />
        <div class="flex items-center justify-center gap-4 mt-6">
          <RouterLink
            v-if="sesiId"
            :to="`/sesi/${sesiId}/hasil`"
            class="rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-2.5 font-semibold transition-colors"
          >
            📊 Lihat Hasil & CSV
          </RouterLink>
          <TombolKembali to="/dashboard" class="text-slate-400 hover:text-white hover:bg-white/10" title="Dashboard" />
        </div>
      </div>

      <!-- Lobby: belum ada slide aktif — kode & QR sejajar supaya daftar peserta di bawah dapat ruang lebih luas -->
      <div v-else-if="!kondisi?.slide" class="text-center w-full max-w-3xl">
        <div class="flex flex-wrap sm:flex-nowrap items-center justify-center gap-6 sm:gap-8 mb-6">
          <div class="bg-white p-3 rounded-2xl shadow-2xl shrink-0">
            <QrcodeVue :value="urlGabung" :size="140" render-as="svg" />
          </div>
          <div class="text-left">
            <p class="text-slate-400 text-sm mb-1">Bergabung di refleksi, kode:</p>
            <p class="font-mono font-black text-5xl sm:text-7xl tracking-wider text-white leading-none [text-shadow:0_0_40px_rgba(59,130,246,0.5)]">
              {{ kode }}
            </p>
            <p class="text-slate-400 text-sm mt-2">atau pindai kode QR di samping</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-4 mb-6">
          <div class="flex items-center gap-2 text-lg">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span class="font-semibold">{{ pesertaTotal }}</span>
            <span class="text-slate-400">peserta sudah bergabung</span>
          </div>
          <button
            class="rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 px-8 py-3 text-lg font-semibold transition-colors shadow-lg shadow-blue-900/30"
            :disabled="daftarSlideRingkas.length === 0"
            @click="pindah(1)"
          >
            ▶ Mulai Presentasi
          </button>
        </div>

        <div v-if="daftarPeserta.length > 0" class="flex flex-wrap items-center justify-center gap-2 max-h-56 overflow-y-auto px-2">
          <span
            v-for="(p, i) in daftarPeserta"
            :key="i"
            class="rounded-full bg-white/10 px-3 py-1.5 text-sm"
          >
            {{ p.nama }}
          </span>
        </div>
        <p v-else class="text-slate-500 text-sm">Menunggu peserta bergabung...</p>
      </div>

      <!-- Slide aktif -->
      <Transition name="slide-ganti" mode="out-in">
        <div v-if="kondisi?.slide && !selesai && !memuat" :key="`${kondisi.slide.id}-${resetCounter}`" class="max-w-2xl w-full text-center space-y-6">
          <p class="inline-flex items-center gap-1.5 text-sm text-slate-300 bg-white/10 rounded-full px-3 py-1">
            {{ metaTipeDari(kondisi.slide.tipe).ikon }} {{ metaTipeDari(kondisi.slide.tipe).label }}
          </p>

          <!-- Gambar pertanyaan presenter -->
          <div v-if="(kondisi.slide.konfig as any).gambar_pertanyaan" class="rounded-2xl overflow-hidden bg-white/5 p-3 border border-white/10 flex justify-center">
            <img :src="(kondisi.slide.konfig as any).gambar_pertanyaan" alt="Gambar pertanyaan" class="max-h-96 max-w-full object-contain rounded-lg" />
          </div>

          <h1 class="text-2xl sm:text-4xl font-bold leading-tight">{{ kondisi.slide.pertanyaan || '(pertanyaan belum diisi)' }}</h1>

          <div v-if="slideAdalahMenti" class="text-left bg-white text-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl">
            <component
              :is="komponenMenti(kondisi.slide.tipe)"
              :slide="kondisi.slide"
              :agregat="agregat"
              mode="presenter"
              :terkunci="!kondisi.dibuka"
              :sudah-jawab="false"
              @sembunyikan="sembunyikanJawaban"
            />
          </div>

          <div v-else-if="slideAdalahKahootAktif" class="text-left bg-white/5 rounded-2xl p-5 sm:p-6 border border-white/10">
            <component
              :is="komponenKahoot(kondisi.slide.tipe)"
              :slide="kondisi.slide"
              mode="presenter"
              :terkunci="!kondisi.dibuka"
              :sudah-jawab="false"
              :mulai-slide-at="kondisi.mulaiSlideAt"
              :hasil="hasilKuis"
              :kunci-tambahan="kunciTambahan"
              :leaderboard="leaderboard"
              :umpan-balik="null"
            />
          </div>
          <p v-else class="text-slate-400 text-sm">Tampilan untuk tipe soal ini menyusul di fase berikutnya.</p>
        </div>
      </Transition>
    </main>

    <footer v-if="!memuat && !selesai && kondisi?.slide" class="flex items-center justify-center gap-2 sm:gap-3 py-4 bg-slate-900/70 backdrop-blur border-t border-white/10">
      <button
        :disabled="!adaSebelumnya"
        class="px-4 sm:px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:hover:bg-white/10 transition-colors font-medium"
        @click="pindah(-1)"
      >
        ◀ <span class="hidden sm:inline">Sebelumnya</span>
      </button>
      <button
        class="px-4 sm:px-5 py-2.5 rounded-xl font-medium transition-colors"
        :class="kondisi.dibuka ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30' : 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'"
        @click="toggleKunci"
      >
        {{ kondisi.dibuka ? '🔓 Kunci Jawaban' : '🔒 Buka Jawaban' }}
      </button>
      <button
        class="px-4 sm:px-5 py-2.5 rounded-xl bg-white/10 hover:bg-red-500/20 hover:text-red-200 transition-colors font-medium"
        title="Hapus semua jawaban pertanyaan ini dan mulai ulang dari nol"
        @click="resetJawaban"
      >
        🔄 <span class="hidden sm:inline">Reset</span>
      </button>
      <button
        :disabled="!adaBerikutnya"
        class="px-4 sm:px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-25 disabled:hover:bg-blue-600 transition-colors font-medium"
        @click="pindah(1)"
      >
        <span class="hidden sm:inline">Berikutnya</span> ▶
      </button>
    </footer>
  </div>
</template>

<style scoped>
.slide-ganti-enter-active,
.slide-ganti-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.slide-ganti-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.slide-ganti-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>

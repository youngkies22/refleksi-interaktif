<script setup lang="ts">
/**
 * Remote kontrol guru dari HP — dipakai sambil berjalan keliling kelas, tanpa
 * perlu balik ke laptop. Sengaja TIDAK menampilkan agregat/detail jawaban
 * (itu tugas layar proyektor) — cuma next/prev/kunci/selesai, supaya ringan
 * dan cepat dioperasikan satu tangan.
 */
import type { KondisiSesi, Slide } from '@bersama/tipe';
import { slideBerpoin } from '@bersama/tipe';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiPresentasi } from '../api/presentasi.js';
import { apiSesi } from '../api/sesi.js';
import { GalatApi } from '../api/klien.js';
import { useSocket } from '../composables/useSocket.js';
import { META_TIPE } from '../komponen/slide/metaTipe.js';

const route = useRoute();
const router = useRouter();
const kode = String(route.params.kode);
const socket = useSocket();

const memuat = ref(true);
const galat = ref('');
const sesiId = ref<number | null>(null);
const kondisi = ref<KondisiSesi | null>(null);
const daftarSlide = ref<Pick<Slide, 'id' | 'tipe' | 'pertanyaan'>[]>([]);
const pesertaTotal = ref(0);

const indexAktif = computed(() => daftarSlide.value.findIndex((s) => s.id === kondisi.value?.slide?.id));
const adaSebelumnya = computed(() => indexAktif.value > 0);
const adaBerikutnya = computed(() => indexAktif.value >= 0 && indexAktif.value < daftarSlide.value.length - 1);

function metaTipeDari(tipe: Slide['tipe']) {
  return META_TIPE[tipe];
}

async function mulai(): Promise<void> {
  try {
    const r = await apiSesi.olehKode(kode);
    sesiId.value = r.sesiId;
    const detail = await apiPresentasi.detail(r.presentasiId);
    daftarSlide.value = detail.presentasi.slide.map((s) => ({ id: s.id, tipe: s.tipe, pertanyaan: s.pertanyaan }));

    socket.emit('presenter:buka', { sesiId: r.sesiId }, (b) => {
      if (b.ok) kondisi.value = b.data.kondisi;
      else galat.value = b.galat.pesan;
      memuat.value = false;
    });
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal membuka sesi.';
    memuat.value = false;
  }
}

function pindah(delta: number): void {
  const target = daftarSlide.value[indexAktif.value + delta];
  if (!target) return;
  socket.emit('presenter:slide', { slideId: target.id }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}

function toggleKunci(): void {
  if (!kondisi.value?.slide) return;
  socket.emit('presenter:kunci', { slideId: kondisi.value.slide.id, dibuka: !kondisi.value.dibuka }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}

function resetJawaban(): void {
  if (!kondisi.value?.slide) return;
  if (!confirm('Hapus semua jawaban untuk pertanyaan ini dan mulai ulang dari nol?')) return;
  socket.emit('presenter:reset', { slideId: kondisi.value.slide.id }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}

function onKondisi(k: KondisiSesi): void {
  if (k.sesiId === sesiId.value) kondisi.value = k;
}
function onJumlah(d: { online: number; total: number }): void {
  pesertaTotal.value = d.total;
}
function onSelesai(): void {
  void router.push('/dashboard');
}

onMounted(() => {
  socket.on('sesi:kondisi', onKondisi);
  socket.on('peserta:jumlah', onJumlah);
  socket.on('sesi:selesai', onSelesai);
  void mulai();
});
onUnmounted(() => {
  socket.off('sesi:kondisi', onKondisi);
  socket.off('peserta:jumlah', onJumlah);
  socket.off('sesi:selesai', onSelesai);
});
</script>

<template>
  <div class="min-h-screen bg-slate-900 text-white flex flex-col">
    <header class="flex items-center justify-between px-4 py-3 bg-slate-800">
      <span class="font-mono font-black text-xl tracking-widest">{{ kode }}</span>
      <span class="text-sm text-slate-300">👥 {{ pesertaTotal }}</span>
    </header>

    <main class="flex-1 flex items-center justify-center p-6 text-center">
      <p v-if="memuat" class="text-slate-400">Membuka kontrol...</p>
      <p v-else-if="galat" class="text-red-300">{{ galat }}</p>
      <div v-else-if="!kondisi?.slide" class="text-slate-400">Belum ada slide aktif.</div>
      <div v-else>
        <p class="text-sm text-slate-400">{{ metaTipeDari(kondisi.slide.tipe).ikon }} {{ metaTipeDari(kondisi.slide.tipe).label }}</p>
        <p class="text-xl font-semibold mt-2">{{ kondisi.slide.pertanyaan || '(pertanyaan belum diisi)' }}</p>
        <p class="text-xs text-slate-500 mt-3">Slide {{ indexAktif + 1 }} / {{ daftarSlide.length }}</p>
      </div>
    </main>

    <footer class="grid grid-cols-2 gap-2 p-4 bg-slate-800">
      <button
        :disabled="!adaSebelumnya"
        class="col-span-2 sm:col-span-1 rounded-xl bg-slate-700 py-4 text-lg disabled:opacity-30"
        @click="pindah(-1)"
      >
        ◀ Sebelumnya
      </button>
      <button
        :disabled="!adaBerikutnya"
        class="col-span-2 sm:col-span-1 rounded-xl bg-blue-600 py-4 text-lg disabled:opacity-30"
        @click="pindah(1)"
      >
        Berikutnya ▶
      </button>
      <button v-if="kondisi?.slide" class="col-span-2 rounded-xl bg-slate-700 py-3" @click="toggleKunci">
        {{ kondisi.dibuka ? '🔓 Kunci Jawaban' : '🔒 Buka Jawaban' }}
      </button>
      <button v-if="kondisi?.slide" class="col-span-2 rounded-xl bg-slate-700/60 text-red-300 py-3" @click="resetJawaban">
        🔄 Reset Jawaban
      </button>
    </footer>
  </div>
</template>

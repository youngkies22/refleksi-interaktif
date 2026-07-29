<script setup lang="ts">
import type { Kartu, Kolom, Papan } from '@bersama/tipe';
import QrcodeVue from 'qrcode.vue';
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiPapan } from '../api/papan.js';
import { GalatApi } from '../api/klien.js';
import { useSocket } from '../composables/useSocket.js';
import TombolKembali from '../komponen/umum/TombolKembali.vue';

const route = useRoute();
const router = useRouter();
const papanId = Number(route.params.id);
const socket = useSocket();

const papan = ref<Papan | null>(null);
const kolom = ref<Kolom[]>([]);
const kartu = ref<Kartu[]>([]);
const memuat = ref(true);
const galat = ref('');
const kolomBaru = ref('');
const urlGabung = ref('');

/** `pengaturan`: panel setelan/moderasi biasa. `lobby`: layar proyektor
 *  besar (kode+QR) sebelum papan resmi dibuka untuk kelas — meniru alur
 *  lobby `PresenterSesi.vue`, tapi memakai flag `terkunci` yang sudah ada
 *  alih-alih konsep sesi terpisah. */
const mode = ref<'pengaturan' | 'lobby'>('pengaturan');
const pesertaOnline = ref(0);
const daftarPeserta = ref<{ nama: string }[]>([]);

const menunggu = () => kartu.value.filter((k) => !k.disetujui);

async function muat(): Promise<void> {
  memuat.value = true;
  try {
    const r = await apiPapan.detail(papanId);
    papan.value = r.papan;
    kolom.value = r.kolom;
    kartu.value = r.kartu;
    urlGabung.value = `${location.origin}/p/${r.papan.kode}`;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat papan.';
  } finally {
    memuat.value = false;
  }
}
onMounted(muat);

async function ubahSetelan(patch: Parameters<typeof apiPapan.ubah>[1]): Promise<boolean> {
  if (!papan.value) return false;
  try {
    await apiPapan.ubah(papanId, patch);
    await muat();
    return true;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menyimpan setelan.';
    return false;
  }
}

async function tambahKolom(): Promise<void> {
  if (kolomBaru.value.trim() === '') return;
  try {
    await apiPapan.tambahKolom(papanId, kolomBaru.value);
    kolomBaru.value = '';
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menambah kolom.';
  }
}
async function hapusKolom(id: number): Promise<void> {
  if (!confirm('Hapus kolom ini? Kartu di dalamnya akan menjadi tanpa kolom.')) return;
  try {
    await apiPapan.hapusKolom(id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus kolom.';
  }
}

async function setujui(id: number): Promise<void> {
  try {
    await apiPapan.setujuiKartu(id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menyetujui kartu.';
  }
}
async function tolak(id: number): Promise<void> {
  if (!confirm('Tolak (hapus) kartu ini?')) return;
  try {
    await apiPapan.hapusKartu(id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menolak kartu.';
  }
}

async function resetPapan(): Promise<void> {
  if (
    !confirm(
      `Kosongkan papan ini?\n\nSemua ${kartu.value.length} kartu beserta like & komentarnya akan DIHAPUS permanen. Kolom dan setelan papan tetap dipertahankan, jadi papan langsung siap dipakai kelas berikutnya.\n\nUnduh CSV-nya dulu kalau datanya masih diperlukan.`,
    )
  ) {
    return;
  }
  try {
    const r = await apiPapan.reset(papanId);
    await muat();
    alert(`Papan dikosongkan — ${r.dihapus} kartu dihapus.`);
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal mengosongkan papan.';
  }
}

function onPesertaJumlah(d: { online: number; daftar: { nama: string }[] }): void {
  pesertaOnline.value = d.online;
  daftarPeserta.value = d.daftar;
}

/**
 * Masuk ke layar lobby: kunci papan dulu (siswa bisa join & lihat kode,
 * tapi belum bisa kirim kartu) sampai guru menekan "Buka Papan Sekarang" —
 * guru yang menentukan momen persisnya, sama seperti "Mulai Presentasi".
 */
async function mulai(): Promise<void> {
  const berhasil = await ubahSetelan({ terkunci: true });
  if (!berhasil) return; // galat sudah diisi oleh ubahSetelan

  mode.value = 'lobby';
  socket.emit('papan:guru_masuk', { papanId }, (b) => {
    if (b.ok) onPesertaJumlah(b.data);
  });
  socket.on('papan:peserta_jumlah', onPesertaJumlah);
}

function kembaliKePengaturan(): void {
  socket.off('papan:peserta_jumlah', onPesertaJumlah);
  mode.value = 'pengaturan';
}

async function bukaPapanSekarang(): Promise<void> {
  if (!papan.value) return;
  const berhasil = await ubahSetelan({ terkunci: false });
  if (!berhasil) return;

  socket.off('papan:peserta_jumlah', onPesertaJumlah);
  await router.push({ path: `/p/${papan.value.kode}`, query: { atur: String(papanId) } });
}

onUnmounted(() => socket.off('papan:peserta_jumlah', onPesertaJumlah));
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <TombolKembali
          class="text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          title="Dashboard"
          @click="router.push('/dashboard')"
        />
        <h1 class="font-semibold text-slate-800">{{ papan?.judul ?? 'Memuat...' }}</h1>
      </div>
      <div class="flex items-center gap-4">
        <button
          v-if="papan"
          class="rounded-xl bg-blue-600 text-white text-sm font-semibold px-4 py-2 hover:bg-blue-700 transition-colors"
          @click="mulai"
        >
          🚀 Mulai
        </button>
      </div>
    </header>

    <p v-if="galat" class="max-w-3xl mx-auto mt-4 px-4 text-sm text-red-600">{{ galat }}</p>
    <main v-if="memuat" class="max-w-3xl mx-auto px-6 py-10 text-slate-400">Memuat...</main>

    <main v-else-if="papan && mode === 'pengaturan'" class="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <!-- Unduh & kosongkan: dipakai guru di pergantian jam pelajaran -->
      <section class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="font-semibold text-slate-700 mb-1">📥 Data Papan</h2>
        <p class="text-xs text-slate-400 mb-4">
          {{ kartu.length }} kartu tersimpan. Unduh dulu sebelum mengosongkan — kolom & setelan tidak ikut terhapus.
        </p>
        <div class="flex flex-wrap gap-2">
          <a
            :href="apiPapan.urlCsv(papanId)"
            class="rounded-xl bg-emerald-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-emerald-700 transition-colors"
          >
            ⬇ Unduh CSV
          </a>
          <button
            :disabled="kartu.length === 0"
            class="rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-sm font-semibold px-4 py-2.5 hover:bg-amber-100 disabled:opacity-40 transition-colors"
            @click="resetPapan"
          >
            🔄 Kosongkan Papan
          </button>
        </div>
      </section>

      <!-- Setelan -->
      <section class="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
        <h2 class="font-semibold text-slate-700 mb-2">Setelan</h2>
        <label class="flex items-center justify-between text-sm">
          <span>Anonim (nama penulis tidak disimpan)</span>
          <input type="checkbox" :checked="papan.anonim" @change="ubahSetelan({ anonim: !papan.anonim })" />
        </label>
        <label class="flex items-center justify-between text-sm">
          <span>Perlu persetujuan sebelum tampil</span>
          <input type="checkbox" :checked="papan.perluPersetujuan" @change="ubahSetelan({ perluPersetujuan: !papan.perluPersetujuan })" />
        </label>
        <label class="flex items-center justify-between text-sm">
          <span>Izinkan like</span>
          <input type="checkbox" :checked="papan.izinkanLike" @change="ubahSetelan({ izinkanLike: !papan.izinkanLike })" />
        </label>
        <label class="flex items-center justify-between text-sm">
          <span>Izinkan komentar</span>
          <input type="checkbox" :checked="papan.izinkanKomentar" @change="ubahSetelan({ izinkanKomentar: !papan.izinkanKomentar })" />
        </label>
        <label class="flex items-center justify-between text-sm">
          <span>Kunci papan (tidak menerima kartu baru)</span>
          <input type="checkbox" :checked="papan.terkunci" @change="ubahSetelan({ terkunci: !papan.terkunci })" />
        </label>
      </section>

      <!-- Kolom -->
      <section class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="font-semibold text-slate-700 mb-3">Kolom</h2>
        <ul class="space-y-2 mb-3">
          <li v-for="k in kolom" :key="k.id" class="flex items-center justify-between text-sm bg-slate-50 rounded-lg py-2 px-3">
            {{ k.judul }}
            <button class="text-slate-300 hover:text-red-500" @click="hapusKolom(k.id)">✕</button>
          </li>
        </ul>
        <form class="flex gap-2" @submit.prevent="tambahKolom">
          <input v-model="kolomBaru" type="text" placeholder="Nama kolom baru..." class="flex-1 text-sm rounded-lg border border-slate-300 py-1.5 px-3" />
          <button type="submit" class="text-sm text-blue-600 font-medium px-3">+ Tambah</button>
        </form>
      </section>

      <!-- Antrean moderasi -->
      <section v-if="papan.perluPersetujuan" class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="font-semibold text-slate-700 mb-3">Menunggu Persetujuan ({{ menunggu().length }})</h2>
        <p v-if="menunggu().length === 0" class="text-sm text-slate-400">Tidak ada kartu yang menunggu.</p>
        <div v-for="k in menunggu()" :key="k.id" class="border border-amber-200 bg-amber-50 rounded-xl p-3 mb-2">
          <p v-if="k.judul" class="font-medium text-sm">{{ k.judul }}</p>
          <p class="text-sm text-slate-700">{{ k.isi }}</p>
          <div class="flex gap-2 mt-2">
            <button class="text-xs bg-emerald-600 text-white rounded-lg px-3 py-1" @click="setujui(k.id)">Setujui</button>
            <button class="text-xs bg-red-100 text-red-600 rounded-lg px-3 py-1" @click="tolak(k.id)">Tolak</button>
          </div>
        </div>
      </section>
    </main>

    <!-- Lobby: papan terkunci, kode & QR besar untuk ditampilkan ke kelas
         sampai guru menekan "Buka Papan Sekarang" -->
    <main
      v-else-if="papan && mode === 'lobby'"
      class="min-h-screen flex flex-col items-center justify-center text-white text-center px-4"
      style="background: radial-gradient(circle at top, #1e293b 0%, #0f172a 65%);"
    >
      <div class="flex flex-wrap sm:flex-nowrap items-center justify-center gap-6 sm:gap-8 mb-8">
        <div class="bg-white p-3 rounded-2xl shadow-2xl shrink-0">
          <QrcodeVue :value="urlGabung" :size="140" render-as="svg" />
        </div>
        <div class="text-left">
          <p class="text-slate-400 text-sm mb-1">Bergabung di refleksi, kode:</p>
          <p class="font-mono font-black text-5xl sm:text-7xl tracking-wider text-white leading-none [text-shadow:0_0_40px_rgba(59,130,246,0.5)]">
            {{ papan.kode }}
          </p>
          <p class="text-slate-400 text-sm mt-2">atau pindai kode QR di samping</p>
        </div>
      </div>

      <div class="flex items-center gap-2 text-lg mb-6">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="font-semibold">{{ pesertaOnline }}</span>
        <span class="text-slate-400">peserta sudah bergabung</span>
      </div>

      <div v-if="daftarPeserta.length > 0" class="flex flex-wrap items-center justify-center gap-2 max-h-40 overflow-y-auto px-2 mb-8">
        <span v-for="(p, i) in daftarPeserta" :key="i" class="rounded-full bg-white/10 px-3 py-1.5 text-sm">
          {{ p.nama }}
        </span>
      </div>
      <p v-else class="text-slate-500 text-sm mb-8">Menunggu peserta bergabung...</p>

      <div class="flex items-center gap-4">
        <button
          class="rounded-2xl bg-blue-600 hover:bg-blue-700 px-8 py-3 text-lg font-semibold transition-colors shadow-lg shadow-blue-900/30"
          @click="bukaPapanSekarang"
        >
          🔓 Buka Papan Sekarang
        </button>
        <TombolKembali
          class="text-slate-400 hover:text-white hover:bg-white/10"
          title="Batal, kembali ke pengaturan"
          @click="kembaliKePengaturan"
        />
      </div>
    </main>
  </div>
</template>

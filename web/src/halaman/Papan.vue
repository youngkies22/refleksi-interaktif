<script setup lang="ts">
import type { Kartu, Kolom, Komentar, Papan } from '@bersama/tipe';
import { BATAS } from '@bersama/konstanta';
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import draggable from 'vuedraggable';
import { useRoute } from 'vue-router';
import { apiUnggah } from '../api/unggah.js';
import { GalatApi } from '../api/klien.js';
import { ambilTokenTersimpan, simpanToken } from '../composables/usePeserta.js';
import { useSocket } from '../composables/useSocket.js';
import KartuVue from '../komponen/papan/Kartu.vue';
import TombolKembali from '../komponen/umum/TombolKembali.vue';
import { useAuthStore } from '../stores/auth.js';

const route = useRoute();
const kode = String(route.params.kode).toUpperCase();
const socket = useSocket();
const auth = useAuthStore();

/** Terisi kalau halaman ini dibuka lewat "Buka Papan Sekarang" di
 *  `AturPapan.vue` (guru pemilik papan) — dipakai untuk lewati form nama
 *  (guru cuma mau memantau/proyeksikan, bukan menulis kartu) dan
 *  menampilkan tautan "← Kembali ke Pengaturan". */
const guruAturId = typeof route.query.atur === 'string' ? route.query.atur : null;

const nama = ref('');
const token = ref(''); // diisi setelah `masuk()` — dipakai untuk unggah lampiran kartu
const sudahMasuk = ref(false);
const menghubungkan = ref(false);
const galat = ref('');
const papan = ref<Papan | null>(null);
const kolom = ref<Kolom[]>([]);
const formTerbuka = ref<number | null>(null); // kolomId sedang menulis kartu baru
const judulBaru = ref('');
const isiBaru = ref('');
const warnaBaru = ref('kuning');
const lampiranBaru = ref(''); // path gambar hasil unggah, kosong = tanpa lampiran
const mengunggahLampiran = ref(false);
const galatUnggah = ref('');

// Kelas Tailwind harus berupa string LITERAL agar dipindai compiler saat build —
// interpolasi seperti `bg-${w}-200` tidak akan pernah menghasilkan CSS apa pun.
const WARNA_PILIHAN: { nama: string; kelas: string }[] = [
  { nama: 'kuning', kelas: 'bg-amber-200' },
  { nama: 'biru', kelas: 'bg-blue-200' },
  { nama: 'hijau', kelas: 'bg-emerald-200' },
  { nama: 'merah', kelas: 'bg-red-200' },
  { nama: 'ungu', kelas: 'bg-purple-200' },
];

/**
 * Satu ARRAY REAKTIF ASLI per kolom (bukan computed/filter dari daftar induk)
 * — inilah yang membuat `v-model` vuedraggable benar-benar berfungsi: drag
 * memindahkan elemen dengan splice langsung ke array ini, dan itu HANYA
 * ter-refleksi balik dengan benar kalau arraynya memang array sungguhan,
 * bukan hasil filter yang dibuat ulang tiap render.
 */
const kartuPerKolom = reactive<Record<number, Kartu[]>>({});

function cariKartuId(kartuId: number): { kolomId: number; index: number } | null {
  for (const kolomId of Object.keys(kartuPerKolom).map(Number)) {
    const index = kartuPerKolom[kolomId]!.findIndex((k) => k.id === kartuId);
    if (index !== -1) return { kolomId, index };
  }
  return null;
}

function tempatkanKartu(k: Kartu): void {
  if (k.kolomId === null || !(k.kolomId in kartuPerKolom)) return; // 'dinding' tanpa kolom belum didukung
  kartuPerKolom[k.kolomId]!.push(k);
}

async function masuk(): Promise<void> {
  galat.value = '';
  menghubungkan.value = true;
  const tokenLama = ambilTokenTersimpan(`papan_${kode}`);

  socket.emit('papan:masuk', { kode, nama: nama.value, token: tokenLama }, (b) => {
    menghubungkan.value = false;
    if (!b.ok) {
      galat.value = b.galat.pesan;
      return;
    }
    simpanToken(`papan_${kode}`, b.data.token);
    token.value = b.data.token;
    papan.value = b.data.papan;
    kolom.value = b.data.kolom;

    for (const kl of b.data.kolom) kartuPerKolom[kl.id] = [];
    for (const k of [...b.data.kartu].sort((a, c) => a.urutan - c.urutan)) tempatkanKartu(k);

    sudahMasuk.value = true;
  });
}

function bukaForm(kolomId: number): void {
  formTerbuka.value = kolomId;
  judulBaru.value = '';
  isiBaru.value = '';
  warnaBaru.value = 'kuning';
  lampiranBaru.value = '';
  galatUnggah.value = '';
}

async function unggahLampiran(e: Event): Promise<void> {
  const berkas = (e.target as HTMLInputElement).files?.[0];
  if (!berkas) return;
  await prosesUnggahLampiran(berkas);
  (e.target as HTMLInputElement).value = '';
}

function onDropLampiran(e: DragEvent): void {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.classList.remove('border-blue-400', 'bg-blue-50');
  const berkas = e.dataTransfer?.files?.[0];
  if (berkas) prosesUnggahLampiran(berkas);
}

async function prosesUnggahLampiran(berkas: File): Promise<void> {
  // Validasi tipe file
  const tipeYangDiizinkan = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!tipeYangDiizinkan.includes(berkas.type)) {
    galatUnggah.value = 'Tipe file tidak didukung. Gunakan PNG, JPEG, WebP, atau GIF.';
    return;
  }

  // Validasi ukuran (max 10 MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (berkas.size > MAX_SIZE) {
    galatUnggah.value = `Ukuran file terlalu besar. Maksimal 10 MB.`;
    return;
  }

  mengunggahLampiran.value = true;
  galatUnggah.value = '';
  try {
    const r = await apiUnggah.gambarPapan(kode, token.value, berkas);
    lampiranBaru.value = r.path;
  } catch (err) {
    galatUnggah.value = err instanceof GalatApi ? err.message : 'Gagal mengunggah gambar.';
  } finally {
    mengunggahLampiran.value = false;
  }
}

function kirimKartu(): void {
  if (formTerbuka.value === null) return;
  if (judulBaru.value.trim() === '' && isiBaru.value.trim() === '' && !lampiranBaru.value) return;

  socket.emit(
    'papan:kartu_baru',
    {
      kolomId: formTerbuka.value,
      judul: judulBaru.value,
      isi: isiBaru.value,
      warna: warnaBaru.value,
      lampiranPath: lampiranBaru.value || undefined,
    },
    (b) => {
      if (b.ok) {
        tempatkanKartu(b.data.kartu);
        formTerbuka.value = null;
      } else {
        galat.value = b.galat.pesan;
      }
    },
  );
}

/** Dipanggil dari `@change` draggable — hanya kolom TUJUAN yang perlu lapor ke
 *  server (added/moved keduanya berarti "kartu ini kini di sini, posisi ini"). */
function onDragBerubah(kolomId: number, e: { added?: { element: Kartu }; moved?: { element: Kartu } }): void {
  const item = e.added?.element ?? e.moved?.element;
  if (!item) return;
  const urutan = kartuPerKolom[kolomId]!.findIndex((k) => k.id === item.id);
  socket.emit('papan:kartu_pindah', { kartuId: item.id, kolomId, urutan }, () => {});
}

function like(kartuId: number): void {
  socket.emit('papan:like', { kartuId }, () => {});
}
function komentar(kartuId: number, isi: string): void {
  socket.emit('papan:komentar', { kartuId, isi }, () => {});
}
function hapusKartu(kartuId: number): void {
  if (!confirm('Hapus kartu ini?')) return;
  socket.emit('papan:kartu_hapus', { kartuId }, (b) => {
    if (!b.ok) galat.value = b.galat.pesan;
  });
}

function onKartuBaru(d: { kartu: Kartu }): void {
  if (!cariKartuId(d.kartu.id)) tempatkanKartu(d.kartu);
}
function onKartuUpdate(d: { kartu: Kartu }): void {
  const lokasi = cariKartuId(d.kartu.id);
  if (!lokasi) {
    tempatkanKartu(d.kartu);
    return;
  }
  if (lokasi.kolomId === d.kartu.kolomId) {
    // Tetap di kolom yang sama — cukup patch di tempat (jaga posisi drag lokal).
    kartuPerKolom[lokasi.kolomId]![lokasi.index] = { ...kartuPerKolom[lokasi.kolomId]![lokasi.index]!, ...d.kartu };
  } else {
    // Pindah kolom dari SUMBER LAIN (drag oleh viewer lain) — pindahkan juga di sini.
    kartuPerKolom[lokasi.kolomId]!.splice(lokasi.index, 1);
    tempatkanKartu(d.kartu);
  }
}
function onKartuHapus(d: { kartuId: number }): void {
  const lokasi = cariKartuId(d.kartuId);
  if (lokasi) kartuPerKolom[lokasi.kolomId]!.splice(lokasi.index, 1);
}
function onLike(d: { kartuId: number; jumlah: number }): void {
  const lokasi = cariKartuId(d.kartuId);
  if (lokasi) kartuPerKolom[lokasi.kolomId]![lokasi.index]!.jumlahLike = d.jumlah;
}
function onKomentar(d: { kartuId: number; komentar: Komentar }): void {
  const lokasi = cariKartuId(d.kartuId);
  if (lokasi) kartuPerKolom[lokasi.kolomId]![lokasi.index]!.jumlahKomentar += 1;
}

onMounted(() => {
  socket.on('papan:kartu', onKartuBaru);
  socket.on('papan:kartu_update', onKartuUpdate);
  socket.on('papan:kartu_hapus', onKartuHapus);
  socket.on('papan:like', onLike);
  socket.on('papan:komentar', onKomentar);

  const tokenLama = ambilTokenTersimpan(`papan_${kode}`);
  if (tokenLama) {
    void masuk();
  } else if (guruAturId) {
    // Guru datang dari "Buka Papan Sekarang" — pakai nama akunnya sendiri,
    // BUKAN nama kosong, supaya kartu yang ditulis tidak tampil "Anonim".
    nama.value = auth.guru?.nama ?? '';
    void masuk();
  }
});

onUnmounted(() => {
  socket.off('papan:kartu', onKartuBaru);
  socket.off('papan:kartu_update', onKartuUpdate);
  socket.off('papan:kartu_hapus', onKartuHapus);
  socket.off('papan:like', onLike);
  socket.off('papan:komentar', onKomentar);
});
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <!-- Guru datang dari "Buka Papan Sekarang" — langsung join tanpa form nama -->
    <main v-if="!sudahMasuk && guruAturId" class="min-h-screen flex items-center justify-center px-4">
      <p class="text-slate-400">Menghubungkan...</p>
    </main>

    <!-- Form nama, sebelum masuk -->
    <main v-else-if="!sudahMasuk" class="min-h-screen flex items-center justify-center px-4">
      <form class="w-full max-w-sm text-center" @submit.prevent="masuk">
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
          {{ menghubungkan ? 'Menghubungkan...' : 'Gabung Papan' }}
        </button>
      </form>
    </main>

    <template v-else>
      <header class="bg-white border-b border-slate-200 px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <h1 class="font-bold text-slate-800 truncate">{{ papan?.judul }}</h1>
          <p v-if="papan?.anonim" class="text-xs text-slate-400 mt-1">
            🕶 Papan ini anonim — nama penulis kartu tidak ditampilkan (bisa diubah guru di halaman Atur Papan).
          </p>
          <p v-if="papan?.terkunci" class="text-xs text-amber-600 mt-1">Papan ini sudah dikunci — tidak menerima kartu baru.</p>
        </div>
        <TombolKembali
          v-if="guruAturId"
          :to="`/papan/${guruAturId}/atur`"
          class="text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0"
          title="Kembali ke Pengaturan"
        />
      </header>

      <p v-if="galat" class="max-w-6xl mx-auto mt-4 px-4 sm:px-6 text-sm text-red-600">{{ galat }}</p>

      <!-- Kolom digulir horizontal (bukan CSS grid dipaksa muat) supaya di HP tiap
           kolom bisa di-swipe selebar layar, bukan diciutkan sampai tak terbaca. -->
      <main class="max-w-6xl mx-auto py-6">
        <div class="flex gap-4 overflow-x-auto snap-x snap-mandatory px-4 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div
            v-for="k in kolom"
            :key="k.id"
            class="bg-slate-100 rounded-2xl p-3 shrink-0 snap-start w-[85vw] sm:w-72"
          >
            <h2 class="font-semibold text-slate-600 text-sm mb-3 px-1">{{ k.judul }}</h2>

            <draggable
              v-model="kartuPerKolom[k.id]"
              :group="{ name: 'papan' }"
              item-key="id"
              class="space-y-3 min-h-[40px]"
              @change="(e: any) => onDragBerubah(k.id, e)"
            >
              <template #item="{ element: item }">
                <KartuVue
                  :kartu="item"
                  :izinkan-like="papan?.izinkanLike ?? true"
                  :izinkan-komentar="papan?.izinkanKomentar ?? true"
                  @like="like"
                  @komentar="komentar"
                  @hapus="hapusKartu"
                />
              </template>
            </draggable>

            <button
              v-if="!papan?.terkunci && formTerbuka !== k.id"
              type="button"
              class="w-full mt-2 text-sm text-slate-400 hover:text-blue-500 border-2 border-dashed border-slate-300 rounded-xl py-2.5 active:scale-[0.98] transition-transform"
              @click="bukaForm(k.id)"
            >
              + Tambah Kartu
            </button>

            <form v-if="formTerbuka === k.id" class="mt-2 space-y-2 bg-white rounded-xl p-3" @submit.prevent="kirimKartu">
              <input
                v-model="judulBaru"
                type="text"
                :maxlength="BATAS.kartuJudul"
                placeholder="Judul (opsional)"
                class="w-full text-sm rounded-lg border border-slate-300 py-2 px-2.5"
              />
              <textarea
                v-model="isiBaru"
                rows="3"
                :maxlength="BATAS.kartuIsi"
                placeholder="Isi kartu..."
                class="w-full text-sm rounded-lg border border-slate-300 py-2 px-2.5"
              />
              <div class="flex gap-2">
                <button
                  v-for="w in WARNA_PILIHAN"
                  :key="w.nama"
                  type="button"
                  class="w-9 h-9 rounded-full border-2 active:scale-90 transition-transform"
                  :class="[w.kelas, warnaBaru === w.nama ? 'border-slate-500' : 'border-transparent']"
                  @click="warnaBaru = w.nama"
                />
              </div>

              <!-- Preview gambar yang sudah diunggah -->
              <div v-if="lampiranBaru" class="space-y-2">
                <p class="text-xs font-medium text-slate-600">📸 Gambar Lampiran</p>
                <div class="relative inline-block group">
                  <img :src="lampiranBaru" class="max-h-40 max-w-full rounded-lg border-2 border-blue-300 bg-blue-50" />
                  <button
                    type="button"
                    class="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm leading-none shadow-md transition-colors"
                    title="Hapus gambar"
                    @click="lampiranBaru = ''"
                  >
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  class="text-xs text-slate-500 hover:text-blue-600 transition-colors"
                  @click="lampiranBaru = ''"
                >
                  🔄 Ganti gambar
                </button>
              </div>

              <!-- Upload area -->
              <div v-else class="space-y-2">
                <div
                  class="relative border-2 border-dashed border-slate-300 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  @click="($refs.inputLampiran as any)?.click?.()"
                  @dragover.prevent="(e) => (e.currentTarget as HTMLElement).classList.add('border-blue-400', 'bg-blue-50')"
                  @dragleave.prevent="(e) => (e.currentTarget as HTMLElement).classList.remove('border-blue-400', 'bg-blue-50')"
                  @drop="onDropLampiran"
                >
                  <input
                    ref="inputLampiran"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    class="hidden"
                    :disabled="mengunggahLampiran"
                    @change="unggahLampiran"
                  />
                  <div v-if="!mengunggahLampiran" class="space-y-1">
                    <p class="text-2xl">📷</p>
                    <p class="text-sm font-medium text-slate-700">Klik atau tarik gambar di sini</p>
                    <p class="text-xs text-slate-500">PNG, JPEG, WebP, GIF (Max 10 MB)</p>
                  </div>
                  <div v-else class="space-y-1">
                    <p class="text-2xl">⏳</p>
                    <p class="text-sm font-medium text-slate-600">Mengunggah gambar...</p>
                  </div>
                </div>
              </div>

              <!-- Error message -->
              <p v-if="galatUnggah" class="text-xs text-red-600 bg-red-50 rounded-lg p-2 flex items-start gap-2">
                <span>⚠️</span>
                <span>{{ galatUnggah }}</span>
              </p>

              <div class="flex gap-2">
                <button type="submit" :disabled="mengunggahLampiran" class="flex-1 rounded-lg bg-blue-600 text-white text-sm py-2.5 active:scale-[0.98] transition-transform disabled:opacity-50">Kirim</button>
                <button type="button" class="text-sm text-slate-400 px-2" @click="formTerbuka = null">Batal</button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>

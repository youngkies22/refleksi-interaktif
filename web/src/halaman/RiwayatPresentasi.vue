<script setup lang="ts">
/**
 * Halaman terpisah dari editor slide — sengaja BUKAN section di bawah editor.
 * Editor bisa berisi puluhan slide sehingga tabel riwayat terdorong jauh ke
 * bawah dan praktis tidak terlihat; padahal ini justru yang dibuka guru di
 * pergantian jam pelajaran (unduh data kelas tadi, kosongkan untuk kelas
 * berikutnya).
 */
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiPresentasi } from '../api/presentasi.js';
import { apiRekap, type RingkasSesiRiwayat } from '../api/rekap.js';
import { GalatApi } from '../api/klien.js';
import TombolKembali from '../komponen/umum/TombolKembali.vue';

const route = useRoute();
const router = useRouter();
const presentasiId = Number(route.params.id);

const judul = ref('');
const riwayat = ref<RingkasSesiRiwayat[]>([]);
const memuat = ref(true);
const galat = ref('');
const sibuk = ref(false);

async function muat(): Promise<void> {
  memuat.value = true;
  galat.value = '';
  try {
    const [rp, rs] = await Promise.all([
      apiPresentasi.detail(presentasiId),
      apiRekap.riwayatSesi(presentasiId),
    ]);
    judul.value = rp.presentasi.judul;
    riwayat.value = rs.sesi;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat riwayat sesi.';
  } finally {
    memuat.value = false;
  }
}

onMounted(muat);

function urlCsv(sesiId: number): string {
  return apiRekap.urlCsv(sesiId);
}

async function resetSesi(s: RingkasSesiRiwayat): Promise<void> {
  if (
    !confirm(
      `Kosongkan sesi kode ${s.kode}?\n\n${s.jumlahPeserta} peserta dan ${s.jumlahJawaban} jawaban akan DIHAPUS supaya sesi ini bisa dipakai ulang untuk kelas berikutnya.\n\nUnduh CSV-nya dulu kalau datanya masih diperlukan — tindakan ini tidak bisa dibatalkan.`,
    )
  ) {
    return;
  }
  sibuk.value = true;
  try {
    const r = await apiRekap.resetSesi(s.sesiId);
    await muat();
    if (r.kode !== s.kode) {
      alert(`Sesi dikosongkan. Kode lama sudah dipakai sesi lain, jadi kode barunya: ${r.kode}`);
    }
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal mengosongkan sesi.';
  } finally {
    sibuk.value = false;
  }
}

async function hapusSesi(s: RingkasSesiRiwayat): Promise<void> {
  if (!confirm(`Hapus permanen sesi kode ${s.kode} beserta ${s.jumlahJawaban} jawabannya?`)) return;
  sibuk.value = true;
  try {
    await apiRekap.hapusSesi(s.sesiId);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus sesi.';
  } finally {
    sibuk.value = false;
  }
}

function labelWaktu(iso: string | null): string {
  if (!iso) return '—';
  // SQLite menyimpan `datetime('now')` sebagai UTC tanpa penanda zona; tanpa
  // 'Z' eksplisit, browser menganggapnya waktu lokal dan jamnya meleset.
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="bg-white border-b border-slate-200 px-6 py-4">
      <div class="max-w-5xl mx-auto flex items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <TombolKembali
            class="text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0"
            title="Kembali ke editor"
            @click="router.push(`/presentasi/${presentasiId}/edit`)"
          />
          <div class="min-w-0">
            <h1 class="font-semibold text-slate-800 truncate">📊 Riwayat Sesi & Unduh Data</h1>
            <p class="text-xs text-slate-400 truncate">{{ judul || 'Memuat...' }}</p>
          </div>
        </div>
        <button class="text-sm text-slate-400 hover:text-slate-600 shrink-0" @click="muat">⟳ Segarkan</button>
      </div>
    </header>

    <p v-if="galat" class="max-w-5xl mx-auto mt-4 px-6 text-sm text-red-600">{{ galat }}</p>

    <main class="max-w-5xl mx-auto px-6 py-8">
      <p v-if="memuat" class="text-slate-400 text-sm py-10 text-center">Memuat riwayat...</p>

      <div v-else-if="riwayat.length === 0" class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-12 text-center">
        <p class="text-4xl mb-3">📭</p>
        <p class="text-slate-500 font-medium">Presentasi ini belum pernah dijalankan</p>
        <p class="text-sm text-slate-400 mt-1">Setiap kali dimulai, datanya akan muncul di sini sebagai sesi terpisah.</p>
        <RouterLink
          :to="`/presentasi/${presentasiId}/mulai`"
          class="inline-block mt-5 rounded-xl bg-green-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-green-700 transition-colors"
        >
          Mulai Sesi Sekarang
        </RouterLink>
      </div>

      <template v-else>
        <p class="text-sm text-slate-500 mb-4">
          {{ riwayat.length }} sesi tercatat. Satu presentasi bisa dipakai berkali-kali — tiap kelas tersimpan terpisah.
          <span class="text-amber-600">Unduh CSV sebelum mengosongkan.</span>
        </p>

        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th class="py-3 px-4 font-medium">Kode</th>
                  <th class="py-3 px-4 font-medium">Waktu Mulai</th>
                  <th class="py-3 px-4 font-medium">Status</th>
                  <th class="py-3 px-4 font-medium text-right">Peserta</th>
                  <th class="py-3 px-4 font-medium text-right">Jawaban</th>
                  <th class="py-3 px-4 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in riwayat"
                  :key="s.sesiId"
                  class="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors"
                >
                  <td class="py-3 px-4 font-mono font-bold text-slate-700 tracking-wider">{{ s.kode }}</td>
                  <td class="py-3 px-4 text-slate-500 whitespace-nowrap">{{ labelWaktu(s.mulaiAt) }}</td>
                  <td class="py-3 px-4">
                    <span
                      class="text-xs rounded-full px-2 py-0.5 whitespace-nowrap"
                      :class="s.status === 'selesai'
                        ? 'bg-slate-100 text-slate-500'
                        : s.status === 'berjalan'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-amber-50 text-amber-600'"
                    >
                      {{ s.status }}
                    </span>
                  </td>
                  <td class="py-3 px-4 text-right text-slate-600">{{ s.jumlahPeserta }}</td>
                  <td class="py-3 px-4 text-right text-slate-600">{{ s.jumlahJawaban }}</td>
                  <td class="py-3 px-4 text-right whitespace-nowrap">
                    <RouterLink :to="`/sesi/${s.sesiId}/hasil`" class="text-blue-600 hover:underline text-xs px-1.5">
                      Rekap
                    </RouterLink>
                    <a :href="urlCsv(s.sesiId)" class="text-emerald-600 hover:underline text-xs px-1.5">⬇ CSV</a>
                    <button
                      :disabled="sibuk || s.jumlahJawaban + s.jumlahPeserta === 0"
                      class="text-amber-600 hover:underline text-xs px-1.5 disabled:opacity-30 disabled:no-underline"
                      @click="resetSesi(s)"
                    >
                      Kosongkan
                    </button>
                    <button
                      :disabled="sibuk"
                      class="text-slate-300 hover:text-red-500 text-xs px-1.5 disabled:opacity-30"
                      @click="hapusSesi(s)"
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mt-4 text-xs text-slate-400 space-y-1">
          <p><strong class="text-slate-500">Kosongkan</strong> — hapus peserta &amp; jawaban, kode tetap hidup untuk kelas berikutnya.</p>
          <p><strong class="text-slate-500">Hapus</strong> — buang sesi beserta seluruh datanya secara permanen.</p>
        </div>
      </template>
    </main>
  </div>
</template>

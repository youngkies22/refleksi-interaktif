<script setup lang="ts">
import type { GuruAdmin, LogAdminEntri } from '@bersama/tipe';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  apiAdmin,
  type DataUbahGuruAdmin,
  type HasilImporGuru,
  type HasilImporKonten,
  type InfoBackupSnapshot,
} from '../api/admin.js';
import { apiUnggah } from '../api/unggah.js';
import { GalatApi } from '../api/klien.js';
import TombolKembali from '../komponen/umum/TombolKembali.vue';
import { useAuthStore } from '../stores/auth.js';
import { usePengaturanStore } from '../stores/pengaturan.js';

const auth = useAuthStore();
const pengaturan = usePengaturanStore();
const router = useRouter();

const daftar = ref<GuruAdmin[]>([]);
const memuat = ref(true);
const galat = ref('');
const menyimpan = ref(false);

const formBaru = reactive({ username: '', nama: '', password: '', role: 'guru' as 'admin' | 'guru' });
const editId = ref<number | null>(null);
const formEdit = reactive({ username: '', nama: '', password: '', role: 'guru' as 'admin' | 'guru' });

async function muat(): Promise<void> {
  memuat.value = true;
  try {
    const r = await apiAdmin.daftarGuru();
    daftar.value = r.guru;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat daftar guru.';
  } finally {
    memuat.value = false;
  }
}

onMounted(muat);

async function tambahGuru(): Promise<void> {
  galat.value = '';
  menyimpan.value = true;
  try {
    await apiAdmin.buatGuru({ ...formBaru });
    formBaru.username = '';
    formBaru.nama = '';
    formBaru.password = '';
    formBaru.role = 'guru';
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menambah akun guru.';
  } finally {
    menyimpan.value = false;
  }
}

const inputBerkasRef = ref<HTMLInputElement | null>(null);
const berkasImpor = ref<File | null>(null);
const mengimpor = ref(false);
const hasilImpor = ref<HasilImporGuru | null>(null);

function pilihBerkasImpor(e: Event): void {
  const input = e.target as HTMLInputElement;
  berkasImpor.value = input.files?.[0] ?? null;
  hasilImpor.value = null;
}

async function imporCsv(): Promise<void> {
  if (!berkasImpor.value) return;
  galat.value = '';
  hasilImpor.value = null;
  mengimpor.value = true;
  try {
    hasilImpor.value = await apiAdmin.imporGuru(berkasImpor.value);
    berkasImpor.value = null;
    if (inputBerkasRef.value) inputBerkasRef.value.value = '';
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal mengimpor berkas CSV.';
  } finally {
    mengimpor.value = false;
  }
}

const inputBackupRef = ref<HTMLInputElement | null>(null);
const berkasBackup = ref<File | null>(null);
const mengimporBackup = ref(false);
const hasilImporBackup = ref<HasilImporKonten | null>(null);

function pilihBerkasBackup(e: Event): void {
  const input = e.target as HTMLInputElement;
  berkasBackup.value = input.files?.[0] ?? null;
  hasilImporBackup.value = null;
}

async function imporBackup(): Promise<void> {
  if (!berkasBackup.value) return;
  if (
    !confirm(
      'Import backup ini akan MENAMBAHKAN presentasi & papan dari berkas ke database — bukan menimpa yang sudah ada. Setiap baris dipetakan ke akun guru lewat username; yang usernamenya belum ada di sini akan dilewati. Lanjutkan?',
    )
  ) {
    return;
  }
  galat.value = '';
  hasilImporBackup.value = null;
  mengimporBackup.value = true;
  try {
    hasilImporBackup.value = await apiAdmin.imporKonten(berkasBackup.value);
    berkasBackup.value = null;
    if (inputBackupRef.value) inputBackupRef.value.value = '';
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal mengimpor berkas backup.';
  } finally {
    mengimporBackup.value = false;
  }
}

/* ────────────────── Snapshot database (backup berkala server) ────────────────── */

const snapshot = ref<InfoBackupSnapshot[]>([]);
const memuatSnapshot = ref(true);
const memulihkanNama = ref<string | null>(null);

async function muatSnapshot(): Promise<void> {
  memuatSnapshot.value = true;
  try {
    snapshot.value = (await apiAdmin.daftarSnapshot()).snapshot;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat daftar snapshot.';
  } finally {
    memuatSnapshot.value = false;
  }
}

onMounted(muatSnapshot);

const membuatSnapshot = ref(false);

async function buatSnapshotSekarang(): Promise<void> {
  galat.value = '';
  membuatSnapshot.value = true;
  try {
    snapshot.value = (await apiAdmin.buatSnapshotSekarang()).snapshot;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal membuat snapshot.';
  } finally {
    membuatSnapshot.value = false;
  }
}

function formatUkuran(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(1)} KB`;
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`;
}

async function pulihkanSnapshot(nama: string): Promise<void> {
  if (
    !confirm(
      `Pulihkan database dari snapshot "${nama}"?\n\nSeluruh data SAAT INI (akun, presentasi, papan) akan DITIMPA oleh isi snapshot ini. Kondisi sekarang otomatis dicadangkan dulu sebelum ditimpa, jadi masih bisa dibatalkan dengan memulihkan snapshot terbaru itu — tapi tetap pastikan ini snapshot yang benar. Lanjutkan?`,
    )
  ) {
    return;
  }
  galat.value = '';
  memulihkanNama.value = nama;
  try {
    await apiAdmin.pulihkanSnapshot(nama);
    await Promise.all([muat(), muatSnapshot(), muatLog()]);
    alert('Database berhasil dipulihkan.');
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memulihkan snapshot.';
  } finally {
    memulihkanNama.value = null;
  }
}

/* ────────────────── Log aktivitas superadmin ────────────────── */

const logAdmin = ref<LogAdminEntri[]>([]);
const memuatLog = ref(true);

async function muatLog(): Promise<void> {
  memuatLog.value = true;
  try {
    logAdmin.value = (await apiAdmin.daftarLog()).log;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat log aktivitas.';
  } finally {
    memuatLog.value = false;
  }
}

onMounted(muatLog);

const LABEL_AKSI: Record<string, string> = {
  buat_akun: '+ Akun dibuat',
  ubah_akun: '✎ Akun diubah',
  hapus_akun: '🗑 Akun dihapus',
  pulihkan_backup: '♻ Database dipulihkan',
  ubah_pengaturan: '🎨 Branding diubah',
  ubah_pengaturan_s3: '☁️ Konfigurasi S3 diubah',
};

/* ────────────────── Branding aplikasi (nama tab & logo) ────────────────── */

const namaAplikasiForm = ref(pengaturan.namaAplikasi);
const menyimpanNama = ref(false);

async function simpanNamaAplikasi(): Promise<void> {
  const n = namaAplikasiForm.value.trim();
  if (n === '' || n === pengaturan.namaAplikasi) return;
  galat.value = '';
  menyimpanNama.value = true;
  try {
    const r = await apiAdmin.ubahNamaAplikasi(n);
    pengaturan.terapkan(r.pengaturan);
    namaAplikasiForm.value = r.pengaturan.namaAplikasi;
    await muatLog();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal mengubah nama aplikasi.';
  } finally {
    menyimpanNama.value = false;
  }
}

const inputLogoRef = ref<HTMLInputElement | null>(null);
const mengunggahLogo = ref(false);

async function pilihLogo(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const berkas = input.files?.[0];
  input.value = '';
  if (!berkas) return;

  galat.value = '';
  mengunggahLogo.value = true;
  try {
    const r = await apiAdmin.unggahLogo(berkas);
    pengaturan.terapkan(r.pengaturan);
    await muatLog();
  } catch (e2) {
    galat.value = e2 instanceof GalatApi ? e2.message : 'Gagal mengunggah logo.';
  } finally {
    mengunggahLogo.value = false;
  }
}

async function hapusLogo(): Promise<void> {
  if (!confirm('Hapus logo dan kembali ke lambang huruf bawaan?')) return;
  galat.value = '';
  try {
    const r = await apiAdmin.hapusLogo();
    pengaturan.terapkan(r.pengaturan);
    await muatLog();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus logo.';
  }
}

/* ────────────────── Object storage S3 (gambar unggahan) ────────────────── */

const s3Form = reactive({ endpoint: '', region: 'us-east-1', bucket: '', accessKey: '', secretKey: '', urlPublik: '' });
const s3SecretKeyDiatur = ref(false);
const s3Aktif = ref(false);
const s3Memuat = ref(true);
const s3Menyimpan = ref(false);
const s3Menguji = ref(false);
const s3HasilUji = ref<{ ok: boolean; pesan: string } | null>(null);

/** Cloudflare R2: endpoint S3-nya privat, gambar TIDAK BISA disajikan dari
 *  situ langsung — beda dari penyedia lain (NevaObjects/MinIO/dll) yang
 *  endpoint-nya memang publik. Dipakai untuk menandai "URL Publik" wajib
 *  diisi, murni bantuan visual di form (validasi sesungguhnya di server). */
const s3AdalahR2 = computed(() => s3Form.endpoint.includes('.r2.cloudflarestorage.com'));

async function muatS3(): Promise<void> {
  s3Memuat.value = true;
  try {
    const r = await apiAdmin.ambilPengaturanS3();
    s3Form.endpoint = r.pengaturan.endpoint;
    s3Form.region = r.pengaturan.region;
    s3Form.bucket = r.pengaturan.bucket;
    s3Form.accessKey = r.pengaturan.accessKey;
    s3Form.secretKey = '';
    s3Form.urlPublik = r.pengaturan.urlPublik;
    s3SecretKeyDiatur.value = r.pengaturan.secretKeyDiatur;
    s3Aktif.value = r.pengaturan.aktif;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat pengaturan object storage.';
  } finally {
    s3Memuat.value = false;
  }
}
onMounted(muatS3);

async function simpanS3(): Promise<void> {
  galat.value = '';
  s3HasilUji.value = null;
  s3Menyimpan.value = true;
  try {
    const r = await apiAdmin.ubahPengaturanS3({
      endpoint: s3Form.endpoint,
      region: s3Form.region,
      bucket: s3Form.bucket,
      accessKey: s3Form.accessKey,
      secretKey: s3Form.secretKey || undefined,
      urlPublik: s3Form.urlPublik,
    });
    s3SecretKeyDiatur.value = r.pengaturan.secretKeyDiatur;
    s3Aktif.value = r.pengaturan.aktif;
    s3Form.secretKey = '';
    await muatLog();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menyimpan pengaturan object storage.';
  } finally {
    s3Menyimpan.value = false;
  }
}

async function hapusS3(): Promise<void> {
  if (!confirm('Hapus konfigurasi S3? Gambar baru akan kembali disimpan di disk lokal server.')) return;
  galat.value = '';
  s3HasilUji.value = null;
  try {
    const r = await apiAdmin.hapusPengaturanS3();
    s3Form.endpoint = '';
    s3Form.region = r.pengaturan.region;
    s3Form.bucket = '';
    s3Form.accessKey = '';
    s3Form.secretKey = '';
    s3Form.urlPublik = '';
    s3SecretKeyDiatur.value = false;
    s3Aktif.value = false;
    await muatLog();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus pengaturan object storage.';
  }
}

async function ujiS3(): Promise<void> {
  s3Menguji.value = true;
  s3HasilUji.value = null;
  try {
    await apiAdmin.ujiPengaturanS3({
      endpoint: s3Form.endpoint,
      region: s3Form.region,
      bucket: s3Form.bucket,
      accessKey: s3Form.accessKey,
      secretKey: s3Form.secretKey || undefined,
      urlPublik: s3Form.urlPublik,
    });
    s3HasilUji.value = { ok: true, pesan: 'Berhasil — unggah, akses publik, dan hapus berkas uji semua lancar.' };
  } catch (e) {
    s3HasilUji.value = { ok: false, pesan: e instanceof GalatApi ? e.message : 'Uji koneksi gagal.' };
  } finally {
    s3Menguji.value = false;
  }
}

/* ────────────────── Manajemen Gambar ────────────────── */

const daftarGambar = ref<Array<{ nama: string; path: string; ukuranByte: number; tanggal: string; tipe: 'lokal' | 's3' }>>([]);
const pemakaianGambar = ref({ byte: 0, mb: 0 });
const memautGambar = ref(false);
const gatatGambar = ref('');
const sudahMuatGambar = ref(false);

async function muatDaftarGambar(): Promise<void> {
  memautGambar.value = true;
  sudahMuatGambar.value = true;
  gatatGambar.value = '';
  try {
    const r = await apiUnggah.daftarGambar(100, 0);
    daftarGambar.value = r.gambar;
    pemakaianGambar.value = r.pemakaian;
  } catch (e) {
    gatatGambar.value = e instanceof GalatApi ? e.message : 'Gagal memuat daftar gambar.';
  } finally {
    memautGambar.value = false;
  }
}

async function hapusGambarAdmin(path: string, nama: string): Promise<void> {
  if (!confirm(`Hapus gambar "${nama}"?`)) return;
  try {
    await apiUnggah.hapusGambar(path);
    await muatDaftarGambar();
  } catch (e) {
    gatatGambar.value = e instanceof GalatApi ? e.message : 'Gagal menghapus gambar.';
  }
}

/* ────────────────── Tab aktif ────────────────── */

const tabAktif = ref<'akun' | 'impor' | 'log' | 'gambar'>('akun');

const tabs = computed(() => [
  { key: 'akun' as const, label: `👤 Akun Guru (${daftar.value.length})` },
  { key: 'impor' as const, label: '📥 Import Akun & Backup' },
  { key: 'gambar' as const, label: '🖼️ Manajemen Gambar' },
  { key: 'log' as const, label: '📜 Log Aktivitas' },
]);

// Auto-muat daftar gambar saat pertama kali membuka tab gambar
watch(tabAktif, (tab) => {
  if (tab === 'gambar' && !sudahMuatGambar.value) {
    void muatDaftarGambar();
  }
});

function mulaiEdit(g: GuruAdmin): void {
  editId.value = g.id;
  formEdit.username = g.username;
  formEdit.nama = g.nama;
  formEdit.password = '';
  formEdit.role = g.role;
}

function batalEdit(): void {
  editId.value = null;
}

async function simpanEdit(): Promise<void> {
  if (editId.value === null) return;
  galat.value = '';
  menyimpan.value = true;
  try {
    const data: DataUbahGuruAdmin = { username: formEdit.username, nama: formEdit.nama, role: formEdit.role };
    if (formEdit.password.trim() !== '') data.password = formEdit.password;
    await apiAdmin.ubahGuru(editId.value, data);
    editId.value = null;
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menyimpan perubahan.';
  } finally {
    menyimpan.value = false;
  }
}

async function toggleBlokir(g: GuruAdmin): Promise<void> {
  const aksi = g.aktif ? 'blokir' : 'aktifkan kembali';
  if (!confirm(`Yakin ${aksi} akun "${g.nama}"?`)) return;
  galat.value = '';
  try {
    await apiAdmin.ubahGuru(g.id, { aktif: !g.aktif });
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal mengubah status akun.';
  }
}

async function hapusAkun(g: GuruAdmin): Promise<void> {
  if (
    !confirm(
      `Hapus akun "${g.nama}" (${g.username})?\n\nSEMUA presentasi, papan, dan riwayat sesi milik akun ini akan ikut terhapus permanen. Tindakan tidak bisa dibatalkan.`,
    )
  ) {
    return;
  }
  galat.value = '';
  try {
    await apiAdmin.hapusGuru(g.id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus akun.';
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="bg-white/80 backdrop-blur border-b border-slate-200 sticky top-0 z-10">
      <div class="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <TombolKembali
            class="text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            title="Dashboard"
            @click="router.push('/dashboard')"
          />
          <h1 class="font-semibold text-slate-800">⚙ Kelola Akun Guru</h1>
        </div>
        <span class="text-sm text-slate-400">{{ auth.guru?.nama }} (superadmin)</span>
      </div>
    </header>

    <p v-if="galat" class="max-w-5xl mx-auto mt-4 px-6 text-sm text-red-600">{{ galat }}</p>

    <main class="max-w-5xl mx-auto px-6 py-10">
      <!-- Navigasi tab -->
      <div class="flex gap-1 border-b border-slate-200 mb-8 overflow-x-auto">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors"
          :class="tabAktif === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'"
          @click="tabAktif = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Tab: Akun Guru -->
      <div v-if="tabAktif === 'akun'" class="space-y-10">
        <section class="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 class="text-lg font-semibold text-slate-700 mb-4">+ Tambah Akun Guru</h2>
          <form class="grid grid-cols-1 sm:grid-cols-4 gap-3" @submit.prevent="tambahGuru">
            <input
              v-model="formBaru.nama"
              type="text"
              placeholder="Nama lengkap"
              required
              class="rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              v-model="formBaru.username"
              type="text"
              placeholder="Username"
              required
              class="rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              v-model="formBaru.password"
              type="text"
              placeholder="Password awal (min 6 karakter)"
              required
              class="rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div class="flex gap-2">
              <select v-model="formBaru.role" class="rounded-xl border border-slate-300 py-2.5 px-3 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="guru">Guru</option>
                <option value="admin">Superadmin</option>
              </select>
              <button
                type="submit"
                :disabled="menyimpan"
                class="shrink-0 rounded-xl bg-blue-600 text-white text-sm font-semibold px-4 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                + Buat
              </button>
            </div>
          </form>
        </section>

        <section>
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-slate-700">Semua Akun ({{ daftar.length }})</h2>
            <a
              :href="apiAdmin.urlEksporGuru()"
              class="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
            >
              ⬇ Unduh Data (CSV)
            </a>
          </div>
          <div v-if="memuat" class="text-slate-400 text-sm">Memuat...</div>
          <div v-else class="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            <div v-for="g in daftar" :key="g.id" class="p-4">
              <!-- Baris tampil normal -->
              <div v-if="editId !== g.id" class="flex flex-wrap items-center gap-3">
                <span class="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-slate-500 shrink-0">
                  {{ g.nama.charAt(0).toUpperCase() }}
                </span>
                <div class="flex-1 min-w-[10rem]">
                  <p class="font-medium text-slate-800">
                    {{ g.nama }}
                    <span v-if="g.role === 'admin'" class="ml-1 text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">superadmin</span>
                    <span v-if="!g.aktif" class="ml-1 text-xs font-semibold text-red-600 bg-red-50 rounded-full px-2 py-0.5">diblokir</span>
                  </p>
                  <p class="text-xs text-slate-400">@{{ g.username }}</p>
                </div>
                <div class="flex items-center gap-1 text-sm">
                  <button class="text-slate-400 hover:text-blue-600 px-2 py-1" @click="mulaiEdit(g)">Edit</button>
                  <button class="text-slate-400 hover:text-amber-600 px-2 py-1" @click="toggleBlokir(g)">
                    {{ g.aktif ? 'Blokir' : 'Aktifkan' }}
                  </button>
                  <button class="text-slate-400 hover:text-red-600 px-2 py-1" @click="hapusAkun(g)">Hapus</button>
                </div>
              </div>

              <!-- Baris sedang diedit -->
              <form v-else class="grid grid-cols-1 sm:grid-cols-4 gap-2" @submit.prevent="simpanEdit">
                <input v-model="formEdit.nama" type="text" placeholder="Nama" class="rounded-lg border border-slate-300 py-2 px-3 text-sm" />
                <input v-model="formEdit.username" type="text" placeholder="Username" class="rounded-lg border border-slate-300 py-2 px-3 text-sm" />
                <input v-model="formEdit.password" type="text" placeholder="Password baru (opsional)" class="rounded-lg border border-slate-300 py-2 px-3 text-sm" />
                <div class="flex gap-2">
                  <select v-model="formEdit.role" class="rounded-lg border border-slate-300 py-2 px-2 text-sm flex-1">
                    <option value="guru">Guru</option>
                    <option value="admin">Superadmin</option>
                  </select>
                  <button type="submit" :disabled="menyimpan" class="shrink-0 rounded-lg bg-blue-600 text-white text-sm font-semibold px-3 hover:bg-blue-700 disabled:opacity-50">
                    Simpan
                  </button>
                  <button type="button" class="shrink-0 text-slate-400 text-sm px-2" @click="batalEdit">Batal</button>
                </div>
              </form>
            </div>
            <p v-if="daftar.length === 0" class="p-8 text-center text-slate-400 text-sm">Belum ada akun guru.</p>
          </div>
        </section>
      </div>

      <!-- Tab: Import Akun dari CSV & Backup Presentasi/Papan -->
      <div v-if="tabAktif === 'impor'" class="space-y-10">
        <section class="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 class="text-lg font-semibold text-slate-700 mb-1">🎨 Branding Aplikasi</h2>
          <p class="text-xs text-slate-400 mb-4">
            Nama ini tampil di judul tab browser dan header aplikasi; logo tampil di header dashboard & halaman
            gabung peserta (kalau tidak diisi, dipakai lambang huruf pertama nama aplikasi).
          </p>

          <form class="flex flex-wrap items-end gap-3 mb-5" @submit.prevent="simpanNamaAplikasi">
            <div class="flex-1 min-w-[12rem]">
              <label class="block text-xs font-medium text-slate-500 mb-1">Nama aplikasi</label>
              <input
                v-model="namaAplikasiForm"
                type="text"
                maxlength="60"
                class="w-full rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              :disabled="menyimpanNama || namaAplikasiForm.trim() === '' || namaAplikasiForm.trim() === pengaturan.namaAplikasi"
              class="shrink-0 rounded-xl bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {{ menyimpanNama ? 'Menyimpan...' : 'Simpan Nama' }}
            </button>
          </form>

          <div class="flex items-center gap-4">
            <img
              v-if="pengaturan.logoUrl"
              :src="pengaturan.logoUrl"
              alt="Logo aplikasi"
              class="w-14 h-14 rounded-xl object-cover border border-slate-200"
            />
            <span
              v-else
              class="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white font-black text-xl"
            >
              {{ pengaturan.namaAplikasi.charAt(0).toUpperCase() }}
            </span>
            <div class="flex items-center gap-3">
              <input ref="inputLogoRef" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" @change="pilihLogo" />
              <button
                type="button"
                :disabled="mengunggahLogo"
                class="rounded-xl border border-slate-300 bg-white text-slate-600 text-sm font-semibold px-4 py-2 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                @click="inputLogoRef?.click()"
              >
                {{ mengunggahLogo ? 'Mengunggah...' : (pengaturan.logoUrl ? 'Ganti Logo' : 'Unggah Logo') }}
              </button>
              <button
                v-if="pengaturan.logoUrl"
                type="button"
                class="text-sm text-slate-400 hover:text-red-600"
                @click="hapusLogo"
              >
                Hapus
              </button>
            </div>
          </div>
        </section>

        <section class="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 class="text-lg font-semibold text-slate-700 mb-1">☁️ Object Storage (S3)</h2>
          <p class="text-xs text-slate-400 mb-4">
            Tempat gambar unggahan (slide pin-jawaban, logo, lampiran kartu papan) disimpan — gambar dikompres
            otomatis sebelum diunggah. Kompatibel dengan penyedia S3 mana pun (NevaObjects, Cloudflare R2, MinIO,
            dll). Kosongkan semua field & hapus untuk kembali menyimpan di disk lokal server.
          </p>

          <p v-if="s3Memuat" class="text-sm text-slate-400">Memuat...</p>
          <form v-else class="space-y-3" @submit.prevent="simpanS3">
            <div class="grid sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Endpoint</label>
                <input
                  v-model="s3Form.endpoint"
                  type="text"
                  placeholder="https://s3.nevaobjects.id"
                  class="w-full rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p class="text-[11px] text-slate-400 mt-1">
                  Cloudflare R2: <code>https://&lt;account_id&gt;.r2.cloudflarestorage.com</code>
                </p>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Bucket</label>
                <input
                  v-model="s3Form.bucket"
                  type="text"
                  placeholder="refleksi"
                  class="w-full rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Region</label>
                <input
                  v-model="s3Form.region"
                  type="text"
                  :placeholder="s3AdalahR2 ? 'auto' : 'us-east-1'"
                  class="w-full rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p v-if="s3AdalahR2" class="text-[11px] text-amber-600 mt-1">R2 selalu memakai region "auto".</p>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Access Key</label>
                <input
                  v-model="s3Form.accessKey"
                  type="text"
                  autocomplete="off"
                  class="w-full rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-xs font-medium text-slate-500 mb-1">
                  Secret Key
                  <span v-if="s3SecretKeyDiatur" class="text-slate-400 font-normal">(sudah diatur — biarkan kosong untuk tidak mengubah)</span>
                </label>
                <input
                  v-model="s3Form.secretKey"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="s3SecretKeyDiatur ? '••••••••••••••••' : ''"
                  class="w-full rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-xs font-medium text-slate-500 mb-1">
                  URL Publik <span class="text-slate-400 font-normal">(opsional untuk sebagian besar penyedia)</span>
                </label>
                <input
                  v-model="s3Form.urlPublik"
                  type="text"
                  placeholder="https://gambar.contohsekolah.sch.id"
                  class="w-full rounded-xl border border-slate-300 py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p class="text-[11px] mt-1" :class="s3AdalahR2 ? 'text-amber-600' : 'text-slate-400'">
                  <template v-if="s3AdalahR2">
                    ⚠️ WAJIB diisi untuk R2 — endpoint S3 di atas bersifat privat, tidak bisa jadi sumber gambar
                    langsung. Isi dengan custom domain atau subdomain <code>*.r2.dev</code> yang di-bind ke bucket ini
                    (dashboard R2 → bucket → Settings → Public Access).
                  </template>
                  <template v-else>Isi kalau bucket disajikan lewat domain/CDN sendiri. Kosongkan untuk memakai URL endpoint+bucket di atas.</template>
                </p>
              </div>
            </div>

            <p class="text-xs" :class="s3Aktif ? 'text-emerald-600' : 'text-slate-400'">
              {{ s3Aktif ? '● Aktif — gambar baru diunggah ke S3.' : '○ Belum aktif — gambar baru disimpan di disk lokal server.' }}
            </p>
            <p v-if="s3HasilUji" class="text-xs" :class="s3HasilUji.ok ? 'text-emerald-600' : 'text-red-600'">
              {{ s3HasilUji.ok ? '✅' : '❌' }} {{ s3HasilUji.pesan }}
            </p>

            <div class="flex flex-wrap gap-2 pt-1">
              <button
                type="submit"
                :disabled="s3Menyimpan"
                class="rounded-xl bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {{ s3Menyimpan ? 'Menyimpan...' : 'Simpan' }}
              </button>
              <button
                type="button"
                :disabled="s3Menguji"
                class="rounded-xl border border-slate-300 bg-white text-slate-600 text-sm font-semibold px-4 py-2.5 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                @click="ujiS3"
              >
                {{ s3Menguji ? 'Menguji...' : 'Uji Koneksi' }}
              </button>
              <button
                v-if="s3Aktif"
                type="button"
                class="text-sm text-slate-400 hover:text-red-600 px-2"
                @click="hapusS3"
              >
                Hapus Konfigurasi
              </button>
            </div>
          </form>
        </section>

        <section class="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 class="text-lg font-semibold text-slate-700 mb-1">📥 Import Akun dari CSV</h2>
          <p class="text-xs text-slate-400 mb-4">
            Siapkan datanya di Excel/Google Sheets dengan kolom <strong>Nama, Username, Password</strong>, lalu
            simpan/export sebagai CSV.
            <a :href="apiAdmin.urlTemplateImpor()" class="text-blue-600 hover:underline">Unduh contoh template →</a>
          </p>
          <form class="flex flex-wrap items-center gap-3" @submit.prevent="imporCsv">
            <input
              ref="inputBerkasRef"
              type="file"
              accept=".csv,text/csv"
              class="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              @change="pilihBerkasImpor"
            />
            <button
              type="submit"
              :disabled="!berkasImpor || mengimpor"
              class="shrink-0 rounded-xl bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {{ mengimpor ? 'Mengimpor...' : 'Import' }}
            </button>
          </form>

          <div v-if="hasilImpor" class="mt-4 space-y-2">
            <p class="text-sm font-medium" :class="hasilImpor.berhasil.length > 0 ? 'text-emerald-700' : 'text-slate-600'">
              ✓ {{ hasilImpor.berhasil.length }} akun berhasil dibuat.
            </p>
            <div v-if="hasilImpor.gagal.length > 0" class="rounded-xl bg-red-50 border border-red-200 p-3">
              <p class="text-sm font-medium text-red-700 mb-1">{{ hasilImpor.gagal.length }} baris gagal:</p>
              <ul class="text-xs text-red-600 space-y-0.5">
                <li v-for="g in hasilImpor.gagal" :key="g.baris">Baris {{ g.baris }}: {{ g.pesan }}</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 class="text-lg font-semibold text-slate-700 mb-1">🗄 Backup Presentasi & Papan</h2>
          <p class="text-xs text-slate-400 mb-4">
            Cadangkan atau pindahkan SELURUH presentasi & papan milik semua guru (tidak termasuk riwayat sesi kuis
            yang sudah dijalankan) dalam satu berkas JSON. Berguna saat pindah ke instalasi/server lain.
          </p>

          <div class="flex flex-wrap items-center gap-3 mb-4">
            <a
              :href="apiAdmin.urlEksporKonten()"
              class="rounded-xl bg-slate-700 text-white text-sm font-semibold px-4 py-2.5 hover:bg-slate-800 transition-colors"
            >
              ⬇ Unduh Backup (JSON)
            </a>
          </div>

          <form class="flex flex-wrap items-center gap-3" @submit.prevent="imporBackup">
            <input
              ref="inputBackupRef"
              type="file"
              accept=".json,application/json"
              class="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              @change="pilihBerkasBackup"
            />
            <button
              type="submit"
              :disabled="!berkasBackup || mengimporBackup"
              class="shrink-0 rounded-xl bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {{ mengimporBackup ? 'Mengimpor...' : 'Import Backup' }}
            </button>
          </form>
          <p class="text-xs text-slate-400 mt-2">
            Presentasi/papan dipetakan ke akun guru lewat username. Kalau username belum ada di sini, impor akun guru
            itu dulu lewat CSV di atas.
          </p>

          <div v-if="hasilImporBackup" class="mt-4 space-y-2">
            <p class="text-sm font-medium text-emerald-700">
              ✓ {{ hasilImporBackup.presentasi.berhasil }} presentasi & {{ hasilImporBackup.papan.berhasil }} papan
              berhasil diimpor.
            </p>
            <div
              v-if="hasilImporBackup.presentasi.gagal.length > 0 || hasilImporBackup.papan.gagal.length > 0"
              class="rounded-xl bg-red-50 border border-red-200 p-3 space-y-2"
            >
              <div v-if="hasilImporBackup.presentasi.gagal.length > 0">
                <p class="text-sm font-medium text-red-700 mb-1">
                  {{ hasilImporBackup.presentasi.gagal.length }} presentasi gagal:
                </p>
                <ul class="text-xs text-red-600 space-y-0.5">
                  <li v-for="(g, i) in hasilImporBackup.presentasi.gagal" :key="i">"{{ g.judul }}": {{ g.pesan }}</li>
                </ul>
              </div>
              <div v-if="hasilImporBackup.papan.gagal.length > 0">
                <p class="text-sm font-medium text-red-700 mb-1">{{ hasilImporBackup.papan.gagal.length }} papan gagal:</p>
                <ul class="text-xs text-red-600 space-y-0.5">
                  <li v-for="(g, i) in hasilImporBackup.papan.gagal" :key="i">"{{ g.judul }}": {{ g.pesan }}</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section class="bg-white rounded-2xl border border-slate-200 p-6">
          <div class="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h2 class="text-lg font-semibold text-slate-700">🗂 Snapshot Database</h2>
            <button
              type="button"
              :disabled="membuatSnapshot"
              class="shrink-0 rounded-lg border border-slate-300 bg-white text-slate-600 text-xs font-semibold px-3 py-1.5 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
              @click="buatSnapshotSekarang"
            >
              {{ membuatSnapshot ? 'Membuat...' : '+ Snapshot Sekarang' }}
            </button>
          </div>
          <p class="text-xs text-slate-400 mb-4">
            Cadangan OTOMATIS server (seluruh database, termasuk akun & riwayat sesi) — beda dari backup JSON di
            atas yang cuma presentasi & papan. Dibuat sekali sehari di latar belakang, simpanan terbatas jadi yang
            paling lama otomatis terhapus. Bisa juga dipicu manual kapan saja lewat tombol di atas.
          </p>

          <div v-if="memuatSnapshot" class="text-slate-400 text-sm">Memuat...</div>
          <p v-else-if="snapshot.length === 0" class="text-sm text-slate-400">
            Belum ada snapshot. Snapshot pertama akan dibuat otomatis sesuai jadwal backup berkala server.
          </p>
          <div v-else class="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            <div v-for="s in snapshot" :key="s.nama" class="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-700 truncate">{{ s.nama }}</p>
                <p class="text-xs text-slate-400">{{ new Date(s.dibuatPada).toLocaleString('id-ID') }} · {{ formatUkuran(s.ukuranByte) }}</p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <a :href="apiAdmin.urlUnduhSnapshot(s.nama)" class="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline">
                  ⬇ Unduh
                </a>
                <button
                  type="button"
                  :disabled="memulihkanNama === s.nama"
                  class="text-xs font-medium text-amber-600 hover:text-amber-800 disabled:opacity-50"
                  @click="pulihkanSnapshot(s.nama)"
                >
                  {{ memulihkanNama === s.nama ? 'Memulihkan...' : '♻ Pulihkan' }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Tab: Manajemen Gambar -->
      <div v-if="tabAktif === 'gambar'" class="space-y-6">
        <section class="bg-white rounded-2xl border border-slate-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-700">🖼️ Manajemen Gambar</h2>
              <p class="text-xs text-slate-400 mt-1">Kelola semua gambar yang diunggah di slide & kartu papan</p>
            </div>
            <button
              type="button"
              @click="muatDaftarGambar"
              :disabled="memautGambar"
              class="text-sm text-blue-600 hover:text-blue-700 font-medium px-4 py-2 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
            >
              {{ memautGambar ? '⏳ Memuat...' : '🔄 Muat Ulang' }}
            </button>
          </div>

          <!-- Storage info -->
          <div class="grid sm:grid-cols-3 gap-3 mb-6">
            <div class="bg-blue-50 rounded-xl p-3 border border-blue-200">
              <p class="text-xs text-blue-600 font-medium">Total Gambar</p>
              <p class="text-2xl font-bold text-blue-700 mt-1">{{ daftarGambar.length }}</p>
            </div>
            <div class="bg-violet-50 rounded-xl p-3 border border-violet-200">
              <p class="text-xs text-violet-600 font-medium">Pemakaian Storage</p>
              <p class="text-2xl font-bold text-violet-700 mt-1">{{ pemakaianGambar.mb }} MB</p>
            </div>
            <div class="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
              <p class="text-xs text-emerald-600 font-medium">Rata-rata Ukuran</p>
              <p class="text-2xl font-bold text-emerald-700 mt-1">
                {{ daftarGambar.length > 0 ? Math.round(pemakaianGambar.byte / daftarGambar.length / 1024) : 0 }} KB
              </p>
            </div>
          </div>

          <!-- Error -->
          <p v-if="gatatGambar" class="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{{ gatatGambar }}</p>

          <!-- Loading state -->
          <div v-if="memautGambar" class="text-center py-12">
            <p class="text-slate-400">Memuat daftar gambar...</p>
          </div>

          <!-- Empty state -->
          <div v-else-if="daftarGambar.length === 0" class="text-center py-12">
            <p class="text-3xl mb-2">📭</p>
            <p class="text-slate-400">Belum ada gambar yang diunggah</p>
          </div>

          <!-- Gallery grid -->
          <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div v-for="(gambar, i) in daftarGambar" :key="i" class="group relative rounded-xl overflow-hidden bg-slate-100">
              <!-- Image preview -->
              <img :src="gambar.path" :alt="gambar.nama" class="w-full h-40 object-cover" />

              <!-- Overlay -->
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex flex-col items-center justify-center opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  @click="hapusGambarAdmin(gambar.path, gambar.nama)"
                  class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  🗑️ Hapus
                </button>
              </div>

              <!-- Info -->
              <div class="p-2 space-y-1">
                <p class="text-xs font-medium text-slate-700 truncate" :title="gambar.nama">{{ gambar.nama }}</p>
                <div class="flex items-center justify-between text-xs text-slate-500">
                  <span>{{ (gambar.ukuranByte / 1024).toFixed(0) }} KB</span>
                  <span class="text-blue-600 font-medium">{{ gambar.tipe === 's3' ? 'S3' : 'Disk' }}</span>
                </div>
                <p class="text-[10px] text-slate-400">{{ new Date(gambar.tanggal).toLocaleDateString('id-ID') }}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Tab: Log aktivitas superadmin -->
      <div v-if="tabAktif === 'log'">
        <section>
          <h2 class="text-lg font-semibold text-slate-700 mb-1">📜 Log Aktivitas ({{ logAdmin.length }})</h2>
          <p class="text-xs text-slate-400 mb-4">
            Jejak tindakan superadmin — kelola akun guru & pemulihan database. Menampilkan {{ logAdmin.length }}
            entri terbaru.
          </p>

          <div v-if="memuatLog" class="text-slate-400 text-sm">Memuat...</div>
          <p v-else-if="logAdmin.length === 0" class="text-sm text-slate-400">Belum ada aktivitas tercatat.</p>
          <div v-else class="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            <div v-for="l in logAdmin" :key="l.id" class="px-4 py-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-sm font-medium text-slate-700">{{ LABEL_AKSI[l.aksi] ?? l.aksi }}</span>
                <span class="text-xs text-slate-400">{{ new Date(l.createdAt).toLocaleString('id-ID') }}</span>
              </div>
              <p class="text-xs text-slate-500 mt-0.5">{{ l.detail }}</p>
              <p class="text-xs text-slate-400 mt-0.5">oleh {{ l.adminNama }}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

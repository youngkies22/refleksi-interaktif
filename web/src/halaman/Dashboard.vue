<script setup lang="ts">
import type {
  DetailPresentasi,
  Kartu,
  Kolom,
  Papan,
  RingkasPapan,
  RingkasPapanAdmin,
  RingkasPresentasi,
  RingkasPresentasiAdmin,
} from '@bersama/tipe';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiAdmin } from '../api/admin.js';
import { apiPapan } from '../api/papan.js';
import { apiPresentasi } from '../api/presentasi.js';
import { GalatApi } from '../api/klien.js';
import { META_TIPE } from '../komponen/slide/metaTipe.js';
import { useAuthStore } from '../stores/auth.js';
import { usePengaturanStore } from '../stores/pengaturan.js';

const auth = useAuthStore();
const pengaturan = usePengaturanStore();
const router = useRouter();

const isAdmin = computed(() => auth.guru?.role === 'admin');

const daftarPresentasi = ref<RingkasPresentasi[]>([]);
const daftarPapan = ref<RingkasPapan[]>([]);
/** Superadmin tidak punya presentasi/papan sendiri — dua daftar ini dipakai
 *  sebagai ganti, berisi SEMUA guru lewat endpoint admin. */
const semuaPresentasiAdmin = ref<RingkasPresentasiAdmin[]>([]);
const semuaPapanAdmin = ref<RingkasPapanAdmin[]>([]);
const memuat = ref(true);
const galat = ref('');
const judulPresentasiBaru = ref('');
const judulPapanBaru = ref('');
const membuat = ref(false);

async function muat(): Promise<void> {
  memuat.value = true;
  try {
    if (isAdmin.value) {
      const r = await apiAdmin.semuaKonten();
      semuaPresentasiAdmin.value = r.presentasi;
      semuaPapanAdmin.value = r.papan;
    } else {
      const [rp, rb] = await Promise.all([apiPresentasi.daftar(), apiPapan.daftar()]);
      daftarPresentasi.value = rp.presentasi;
      daftarPapan.value = rb.papan;
    }
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat dashboard.';
  } finally {
    memuat.value = false;
  }
}

onMounted(muat);

/* ────────────────── Admin: cari & lihat detail lintas guru ────────────────── */

const kataKunciAdmin = ref('');

function cocokAdmin(judul: string, guruNama: string, guruUsername: string): boolean {
  const k = kataKunciAdmin.value.trim().toLowerCase();
  if (k === '') return true;
  return (
    judul.toLowerCase().includes(k) || guruNama.toLowerCase().includes(k) || guruUsername.toLowerCase().includes(k)
  );
}

const presentasiAdminTersaring = computed(() =>
  semuaPresentasiAdmin.value.filter((p) => cocokAdmin(p.judul, p.guruNama, p.guruUsername)),
);
const papanAdminTersaring = computed(() =>
  semuaPapanAdmin.value.filter((p) => cocokAdmin(p.judul, p.guruNama, p.guruUsername)),
);

const modalTipe = ref<'presentasi' | 'papan' | null>(null);
const memuatDetail = ref(false);
const galatDetail = ref('');
const modalDetailPresentasi = ref<DetailPresentasi | null>(null);
const modalDetailPapan = ref<{ papan: Papan; kolom: Kolom[]; kartu: Kartu[] } | null>(null);

const kartuPerKolom = computed(() => {
  const map = new Map<number | null, Kartu[]>();
  for (const k of modalDetailPapan.value?.kartu ?? []) {
    const arr = map.get(k.kolomId) ?? [];
    arr.push(k);
    map.set(k.kolomId, arr);
  }
  return map;
});

async function lihatPresentasiAdmin(id: number): Promise<void> {
  modalTipe.value = 'presentasi';
  memuatDetail.value = true;
  galatDetail.value = '';
  modalDetailPresentasi.value = null;
  try {
    modalDetailPresentasi.value = (await apiAdmin.detailPresentasi(id)).presentasi;
  } catch (e) {
    galatDetail.value = e instanceof GalatApi ? e.message : 'Gagal memuat detail presentasi.';
  } finally {
    memuatDetail.value = false;
  }
}

async function lihatPapanAdmin(id: number): Promise<void> {
  modalTipe.value = 'papan';
  memuatDetail.value = true;
  galatDetail.value = '';
  modalDetailPapan.value = null;
  try {
    modalDetailPapan.value = await apiAdmin.detailPapan(id);
  } catch (e) {
    galatDetail.value = e instanceof GalatApi ? e.message : 'Gagal memuat detail papan.';
  } finally {
    memuatDetail.value = false;
  }
}

function tutupModal(): void {
  modalTipe.value = null;
}

async function buatPresentasi(): Promise<void> {
  const judul = judulPresentasiBaru.value.trim();
  if (judul === '') return;
  membuat.value = true;
  try {
    const r = await apiPresentasi.buat(judul);
    await router.push(`/presentasi/${r.id}/edit`);
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal membuat presentasi.';
  } finally {
    membuat.value = false;
  }
}

async function hapusPresentasi(id: number): Promise<void> {
  if (!confirm('Hapus presentasi ini beserta seluruh slide-nya?')) return;
  try {
    await apiPresentasi.hapus(id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus presentasi.';
  }
}

const menduplikat = ref<number | null>(null);

async function duplikatPresentasi(id: number): Promise<void> {
  menduplikat.value = id;
  galat.value = '';
  try {
    await apiPresentasi.duplikat(id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menduplikat presentasi.';
  } finally {
    menduplikat.value = null;
  }
}

const kataKunciPresentasi = ref('');
const presentasiTersaring = computed(() => {
  const k = kataKunciPresentasi.value.trim().toLowerCase();
  if (k === '') return daftarPresentasi.value;
  return daftarPresentasi.value.filter((p) => p.judul.toLowerCase().includes(k));
});

const inputImporPresentasiRef = ref<HTMLInputElement | null>(null);
const mengimporPresentasi = ref(false);
const dragOverPresentasi = ref(false);

async function imporPresentasiBerkas(berkas: File): Promise<void> {
  if (!berkas.name.toLowerCase().endsWith('.json')) {
    galat.value = 'Berkas harus berformat .json.';
    return;
  }
  galat.value = '';
  mengimporPresentasi.value = true;
  try {
    const r = await apiPresentasi.impor(berkas);
    await router.push(`/presentasi/${r.id}/edit`);
  } catch (e2) {
    galat.value = e2 instanceof GalatApi ? e2.message : 'Gagal mengimpor presentasi.';
  } finally {
    mengimporPresentasi.value = false;
  }
}

async function pilihImporPresentasi(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const berkas = input.files?.[0];
  if (!berkas) return;
  await imporPresentasiBerkas(berkas);
  input.value = '';
}

async function jatuhkanImporPresentasi(e: DragEvent): Promise<void> {
  dragOverPresentasi.value = false;
  const berkas = e.dataTransfer?.files?.[0];
  if (!berkas) return;
  await imporPresentasiBerkas(berkas);
}

async function buatPapan(): Promise<void> {
  const judul = judulPapanBaru.value.trim();
  if (judul === '') return;
  membuat.value = true;
  try {
    const r = await apiPapan.buat(judul);
    await router.push(`/papan/${r.id}/atur`);
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal membuat papan.';
  } finally {
    membuat.value = false;
  }
}

async function hapusPapan(id: number): Promise<void> {
  if (!confirm('Hapus papan ini beserta seluruh kartunya?')) return;
  try {
    await apiPapan.hapus(id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus papan.';
  }
}

async function duplikatPapan(id: number): Promise<void> {
  menduplikat.value = id;
  galat.value = '';
  try {
    await apiPapan.duplikat(id);
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menduplikat papan.';
  } finally {
    menduplikat.value = null;
  }
}

const kataKunciPapan = ref('');
const papanTersaring = computed(() => {
  const k = kataKunciPapan.value.trim().toLowerCase();
  if (k === '') return daftarPapan.value;
  return daftarPapan.value.filter((p) => p.judul.toLowerCase().includes(k));
});

const totalMenunggu = computed(() => daftarPapan.value.reduce((jumlah, p) => jumlah + p.jumlahMenunggu, 0));

const inputImporPapanRef = ref<HTMLInputElement | null>(null);
const mengimporPapan = ref(false);
const dragOverPapan = ref(false);

async function imporPapanBerkas(berkas: File): Promise<void> {
  if (!berkas.name.toLowerCase().endsWith('.json')) {
    galat.value = 'Berkas harus berformat .json.';
    return;
  }
  galat.value = '';
  mengimporPapan.value = true;
  try {
    const r = await apiPapan.impor(berkas);
    await router.push(`/papan/${r.id}/atur`);
  } catch (e2) {
    galat.value = e2 instanceof GalatApi ? e2.message : 'Gagal mengimpor papan.';
  } finally {
    mengimporPapan.value = false;
  }
}

async function pilihImporPapan(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const berkas = input.files?.[0];
  if (!berkas) return;
  await imporPapanBerkas(berkas);
  input.value = '';
}

async function jatuhkanImporPapan(e: DragEvent): Promise<void> {
  dragOverPapan.value = false;
  const berkas = e.dataTransfer?.files?.[0];
  if (!berkas) return;
  await imporPapanBerkas(berkas);
}

async function keluar(): Promise<void> {
  await auth.keluar();
  await router.push('/masuk');
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="bg-white/80 backdrop-blur border-b border-slate-200 sticky top-0 z-10">
      <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <img v-if="pengaturan.logoUrl" :src="pengaturan.logoUrl" alt="" class="w-8 h-8 rounded-lg object-cover" />
          <span v-else class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white font-black text-sm">
            {{ pengaturan.namaAplikasi.charAt(0).toUpperCase() }}
          </span>
          <h1 class="font-bold text-slate-800 tracking-tight">{{ pengaturan.namaAplikasi }}</h1>
        </div>
        <div class="flex items-center gap-4 text-sm">
          <RouterLink v-if="auth.guru?.role === 'admin'" to="/admin/guru" class="text-slate-500 hover:text-slate-800 transition-colors">⚙ Kelola Guru</RouterLink>
          <RouterLink to="/profil" class="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
            <span class="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
              {{ (auth.guru?.nama ?? '?').charAt(0).toUpperCase() }}
            </span>
            {{ auth.guru?.nama }}
          </RouterLink>
          <button class="text-slate-400 hover:text-red-600 transition-colors" @click="keluar">Keluar</button>
        </div>
      </div>
    </header>

    <p v-if="galat" class="max-w-6xl mx-auto mt-4 px-6 text-sm text-red-600">{{ galat }}</p>
    <div v-if="memuat" class="max-w-6xl mx-auto px-6 py-16 text-center text-slate-400">Memuat dashboard...</div>

    <main v-else class="max-w-6xl mx-auto px-6 py-10 space-y-14">
      <!-- Sapaan -->
      <section>
        <h2 class="text-2xl font-bold text-slate-800">Halo, {{ (auth.guru?.nama ?? 'Guru').split(' ')[0] }} 👋</h2>
        <p class="text-slate-500 mt-1">
          {{ isAdmin ? 'Ringkasan presentasi & papan seluruh guru.' : 'Kelola presentasi interaktif dan papan kolaboratif Anda di sini.' }}
        </p>
        <div class="flex gap-4 mt-5">
          <div class="rounded-2xl bg-white border border-slate-200 px-5 py-3 shadow-sm">
            <p class="text-2xl font-bold text-blue-600">{{ isAdmin ? semuaPresentasiAdmin.length : daftarPresentasi.length }}</p>
            <p class="text-xs text-slate-400">Presentasi{{ isAdmin ? ' (semua guru)' : '' }}</p>
          </div>
          <div class="rounded-2xl bg-white border border-slate-200 px-5 py-3 shadow-sm">
            <p class="text-2xl font-bold text-emerald-600">{{ isAdmin ? semuaPapanAdmin.length : daftarPapan.length }}</p>
            <p class="text-xs text-slate-400">Papan{{ isAdmin ? ' (semua guru)' : '' }}</p>
          </div>
        </div>
      </section>

      <!-- Superadmin tidak membuat presentasi/papan sendiri — cukup daftar
           lengkap lintas guru, dengan pencarian & klik untuk lihat isinya. -->
      <section v-if="isAdmin">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="text-lg font-semibold text-slate-700">
            🗂 Semua Presentasi &amp; Papan ({{ semuaPresentasiAdmin.length + semuaPapanAdmin.length }})
          </h2>
          <input
            v-model="kataKunciAdmin"
            type="text"
            placeholder="Cari judul atau nama guru..."
            class="w-full sm:w-64 rounded-xl border border-slate-300 py-2 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <p class="text-xs text-slate-400 mb-4">Klik salah satu baris untuk melihat isi lengkapnya.</p>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Presentasi -->
          <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <p class="px-4 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">
              🎯 Presentasi ({{ presentasiAdminTersaring.length }})
            </p>
            <p v-if="presentasiAdminTersaring.length === 0" class="p-6 text-center text-xs text-slate-400">
              Tidak ada presentasi yang cocok.
            </p>
            <div v-else class="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
              <div
                v-for="p in presentasiAdminTersaring"
                :key="p.id"
                class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                @click="lihatPresentasiAdmin(p.id)"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-slate-800 truncate">{{ p.judul }}</p>
                  <p class="text-xs text-slate-400 truncate">
                    {{ p.guruNama }} <span class="text-slate-300">· @{{ p.guruUsername }}</span> · {{ p.jumlahSlide }} slide
                  </p>
                </div>
                <a
                  :href="apiAdmin.urlEksporPresentasiGuru(p.guruId, p.id)"
                  download
                  class="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-100 transition-colors shrink-0"
                  title="Unduh backup JSON"
                  @click.stop
                >
                  <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clip-rule="evenodd" /></svg>
                </a>
              </div>
            </div>
          </div>

          <!-- Papan -->
          <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <p class="px-4 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">
              🧩 Papan ({{ papanAdminTersaring.length }})
            </p>
            <p v-if="papanAdminTersaring.length === 0" class="p-6 text-center text-xs text-slate-400">
              Tidak ada papan yang cocok.
            </p>
            <div v-else class="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
              <div
                v-for="p in papanAdminTersaring"
                :key="p.id"
                class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                @click="lihatPapanAdmin(p.id)"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-slate-800 truncate">
                    {{ p.judul }}
                    <span v-if="p.jumlahMenunggu > 0" class="text-amber-600 font-medium">· {{ p.jumlahMenunggu }} menunggu</span>
                  </p>
                  <p class="text-xs text-slate-400 truncate">
                    {{ p.guruNama }} <span class="text-slate-300">· @{{ p.guruUsername }}</span> · {{ p.jumlahKartu }} kartu
                  </p>
                </div>
                <a
                  :href="apiAdmin.urlEksporPapanGuru(p.guruId, p.id)"
                  download
                  class="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-100 transition-colors shrink-0"
                  title="Unduh backup JSON"
                  @click.stop
                >
                  <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clip-rule="evenodd" /></svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Presentasi (Menti + Kahoot) -->
      <section v-if="!isAdmin">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-700">🎯 Presentasi Anda</h2>
          <input
            v-if="daftarPresentasi.length > 0"
            v-model="kataKunciPresentasi"
            type="text"
            placeholder="Cari presentasi..."
            class="w-full sm:w-56 rounded-xl border border-slate-300 py-1.5 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <p class="text-xs text-slate-400 mb-4 mt-1">Yang sudah tidak dipakai bisa dihapus — arahkan kursor ke kartunya.</p>

        <div
          class="mb-5 rounded-2xl border border-slate-200 bg-white p-4 transition-colors"
          :class="dragOverPresentasi ? 'border-blue-400 bg-blue-50/70 ring-2 ring-blue-200' : ''"
          @dragover.prevent="dragOverPresentasi = true"
          @dragleave.prevent="dragOverPresentasi = false"
          @drop.prevent="jatuhkanImporPresentasi"
        >
          <form class="flex flex-col sm:flex-row gap-2" @submit.prevent="buatPresentasi">
            <input
              v-model="judulPresentasiBaru"
              type="text"
              placeholder="Judul presentasi baru..."
              class="flex-1 rounded-xl border border-slate-300 py-2.5 px-4 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div class="flex gap-2">
              <button
                type="submit"
                :disabled="membuat || judulPresentasiBaru.trim() === ''"
                class="shrink-0 rounded-xl bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                + Buat
              </button>
              <input
                ref="inputImporPresentasiRef"
                type="file"
                accept=".json,application/json"
                class="hidden"
                @change="pilihImporPresentasi"
              />
              <button
                type="button"
                :disabled="mengimporPresentasi"
                class="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-slate-600 text-sm font-semibold px-4 py-2.5 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                @click="inputImporPresentasiRef?.click()"
              >
                <svg v-if="!mengimporPresentasi" class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clip-rule="evenodd" /></svg>
                <svg v-else class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                {{ mengimporPresentasi ? 'Mengimpor...' : 'Impor JSON' }}
              </button>
            </div>
          </form>
          <p class="text-xs text-slate-400 mt-2.5 flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" /></svg>
            Seret &amp; lepas berkas <code class="text-slate-500">.json</code> hasil ekspor ke area ini, atau klik "Impor JSON".
          </p>
        </div>

        <div v-if="daftarPresentasi.length === 0" class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-10 text-center">
          <p class="text-3xl mb-2">🎯</p>
          <p class="text-slate-400">Belum ada presentasi. Buat yang pertama di atas.</p>
        </div>
        <div v-else-if="presentasiTersaring.length === 0" class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-10 text-center">
          <p class="text-slate-400">Tidak ada presentasi yang cocok dengan "{{ kataKunciPresentasi }}".</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <div
            v-for="p in presentasiTersaring"
            :key="p.id"
            class="group rounded-xl bg-white border border-slate-200 p-3 hover:border-blue-300 hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            <RouterLink :to="`/presentasi/${p.id}/edit`" class="block">
              <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-sm mb-2">🎯</div>
              <p class="text-sm font-semibold text-slate-800 truncate">{{ p.judul }}</p>
              <p class="text-xs text-slate-400 mt-0.5">{{ p.jumlahSlide }} slide</p>
            </RouterLink>
            <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <div class="flex items-center gap-1">
                <RouterLink :to="`/presentasi/${p.id}/edit`" class="text-xs font-medium text-blue-600 hover:text-blue-700 mr-1">Edit →</RouterLink>
                <RouterLink :to="`/presentasi/${p.id}/riwayat`" class="inline-flex items-center justify-center w-6 h-6 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Lihat riwayat">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" /></svg>
                </RouterLink>
                <button
                  type="button"
                  :disabled="menduplikat === p.id"
                  class="inline-flex items-center justify-center w-6 h-6 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  title="Duplikat presentasi"
                  @click="duplikatPresentasi(p.id)"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" /><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" /></svg>
                </button>
                <a :href="apiPresentasi.urlEkspor(p.id)" download class="inline-flex items-center justify-center w-6 h-6 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Unduh backup JSON">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clip-rule="evenodd" /></svg>
                </a>
              </div>
              <button
                class="text-xs text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                @click="hapusPresentasi(p.id)"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Papan kolaboratif (Padlet) -->
      <section v-if="!isAdmin">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-700">🧩 Papan Anda</h2>
          <input
            v-if="daftarPapan.length > 0"
            v-model="kataKunciPapan"
            type="text"
            placeholder="Cari papan..."
            class="w-full sm:w-56 rounded-xl border border-slate-300 py-1.5 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <p class="text-xs text-slate-400 mb-3 mt-1">Yang sudah tidak dipakai bisa dihapus — arahkan kursor ke kartunya.</p>
        <p v-if="totalMenunggu > 0" class="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 inline-flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>
          {{ totalMenunggu }} kartu menunggu persetujuan — cek papan yang ditandai di bawah.
        </p>

        <div
          class="mb-5 rounded-2xl border border-slate-200 bg-white p-4 transition-colors"
          :class="dragOverPapan ? 'border-emerald-400 bg-emerald-50/70 ring-2 ring-emerald-200' : ''"
          @dragover.prevent="dragOverPapan = true"
          @dragleave.prevent="dragOverPapan = false"
          @drop.prevent="jatuhkanImporPapan"
        >
          <form class="flex flex-col sm:flex-row gap-2" @submit.prevent="buatPapan">
            <input
              v-model="judulPapanBaru"
              type="text"
              placeholder="Judul papan baru..."
              class="flex-1 rounded-xl border border-slate-300 py-2.5 px-4 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div class="flex gap-2">
              <button
                type="submit"
                :disabled="membuat || judulPapanBaru.trim() === ''"
                class="shrink-0 rounded-xl bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                + Buat
              </button>
              <input
                ref="inputImporPapanRef"
                type="file"
                accept=".json,application/json"
                class="hidden"
                @change="pilihImporPapan"
              />
              <button
                type="button"
                :disabled="mengimporPapan"
                class="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-slate-600 text-sm font-semibold px-4 py-2.5 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                @click="inputImporPapanRef?.click()"
              >
                <svg v-if="!mengimporPapan" class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clip-rule="evenodd" /></svg>
                <svg v-else class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                {{ mengimporPapan ? 'Mengimpor...' : 'Impor JSON' }}
              </button>
            </div>
          </form>
          <p class="text-xs text-slate-400 mt-2.5 flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" /></svg>
            Seret &amp; lepas berkas <code class="text-slate-500">.json</code> hasil ekspor ke area ini, atau klik "Impor JSON".
          </p>
        </div>

        <div v-if="daftarPapan.length === 0" class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-10 text-center">
          <p class="text-3xl mb-2">🧩</p>
          <p class="text-slate-400">Belum ada papan. Buat yang pertama di atas.</p>
        </div>
        <div v-else-if="papanTersaring.length === 0" class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-10 text-center">
          <p class="text-slate-400">Tidak ada papan yang cocok dengan "{{ kataKunciPapan }}".</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <div
            v-for="p in papanTersaring"
            :key="p.id"
            class="group relative rounded-xl bg-white border border-slate-200 p-3 hover:border-emerald-300 hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            <span
              v-if="p.jumlahMenunggu > 0"
              class="absolute -top-2 -right-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm"
              :title="`${p.jumlahMenunggu} kartu menunggu persetujuan`"
            >
              {{ p.jumlahMenunggu }}
            </span>
            <RouterLink :to="`/papan/${p.id}/atur`" class="block">
              <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm mb-2">🧩</div>
              <p class="text-sm font-semibold text-slate-800 truncate">{{ p.judul }}</p>
              <p class="text-xs text-slate-400 mt-0.5">{{ p.jumlahKartu }} kartu</p>
            </RouterLink>
            <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <div class="flex items-center gap-1">
                <RouterLink :to="`/papan/${p.id}/atur`" class="text-xs font-medium text-emerald-600 hover:text-emerald-700 mr-1">Atur →</RouterLink>
                <button
                  type="button"
                  :disabled="menduplikat === p.id"
                  class="inline-flex items-center justify-center w-6 h-6 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                  title="Duplikat papan"
                  @click="duplikatPapan(p.id)"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" /><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" /></svg>
                </button>
                <a :href="apiPapan.urlEkspor(p.id)" download class="inline-flex items-center justify-center w-6 h-6 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="Unduh backup JSON">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clip-rule="evenodd" /></svg>
                </a>
              </div>
              <button
                class="text-xs text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                @click="hapusPapan(p.id)"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Modal admin: detail lengkap satu presentasi/papan lintas guru -->
    <div
      v-if="modalTipe"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      @click.self="tutupModal"
    >
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 class="font-semibold text-slate-800 truncate pr-4">
            {{ modalTipe === 'presentasi' ? modalDetailPresentasi?.judul ?? 'Memuat...' : modalDetailPapan?.papan.judul ?? 'Memuat...' }}
          </h3>
          <button class="text-slate-400 hover:text-slate-600 shrink-0 text-lg leading-none" @click="tutupModal">✕</button>
        </div>
        <div class="overflow-y-auto p-5">
          <div v-if="memuatDetail" class="text-sm text-slate-400 text-center py-8">Memuat...</div>
          <p v-else-if="galatDetail" class="text-sm text-red-600">{{ galatDetail }}</p>

          <!-- Isi presentasi: seluruh slide + opsi -->
          <div v-else-if="modalTipe === 'presentasi' && modalDetailPresentasi" class="space-y-3">
            <p v-if="modalDetailPresentasi.slide.length === 0" class="text-sm text-slate-400 text-center py-6">
              Belum ada slide.
            </p>
            <div v-for="(s, i) in modalDetailPresentasi.slide" :key="s.id" class="rounded-xl border border-slate-200 p-4">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-semibold text-slate-400">#{{ i + 1 }}</span>
                <span class="text-xs font-medium text-slate-600 bg-slate-100 rounded-full px-2 py-0.5">
                  {{ META_TIPE[s.tipe].ikon }} {{ META_TIPE[s.tipe].label }}
                </span>
              </div>
              <p class="text-sm text-slate-800 mb-2">{{ s.pertanyaan || '(belum ada pertanyaan)' }}</p>
              <ul v-if="s.opsi.length > 0" class="space-y-1">
                <li
                  v-for="o in s.opsi"
                  :key="o.id"
                  class="text-sm px-3 py-1.5 rounded-lg"
                  :class="o.benar ? 'bg-emerald-50 text-emerald-700 font-medium' : 'bg-slate-50 text-slate-600'"
                >
                  {{ o.benar ? '✓ ' : '' }}{{ o.teks }}
                </li>
              </ul>
            </div>
          </div>

          <!-- Isi papan: seluruh kartu, dikelompokkan per kolom -->
          <div v-else-if="modalTipe === 'papan' && modalDetailPapan" class="space-y-4">
            <p v-if="modalDetailPapan.kartu.length === 0" class="text-sm text-slate-400 text-center py-6">
              Belum ada kartu.
            </p>
            <div v-for="kol in modalDetailPapan.kolom" :key="kol.id">
              <p class="text-xs font-semibold text-slate-500 mb-2">
                {{ kol.judul }} ({{ (kartuPerKolom.get(kol.id) ?? []).length }})
              </p>
              <div class="space-y-2">
                <div v-for="k in kartuPerKolom.get(kol.id) ?? []" :key="k.id" class="rounded-xl border border-slate-200 p-3">
                  <p v-if="k.judul" class="text-sm font-medium text-slate-800">{{ k.judul }}</p>
                  <p class="text-sm text-slate-600 whitespace-pre-wrap">{{ k.isi }}</p>
                  <p class="text-xs text-slate-400 mt-1.5">
                    {{ k.penulisNama ?? 'Anonim' }}
                    <span v-if="!k.disetujui" class="ml-1 text-amber-600 font-medium">· menunggu persetujuan</span>
                  </p>
                </div>
              </div>
            </div>
            <div v-if="(kartuPerKolom.get(null) ?? []).length > 0">
              <p class="text-xs font-semibold text-slate-500 mb-2">
                Tanpa kolom ({{ (kartuPerKolom.get(null) ?? []).length }})
              </p>
              <div class="space-y-2">
                <div v-for="k in kartuPerKolom.get(null) ?? []" :key="k.id" class="rounded-xl border border-slate-200 p-3">
                  <p v-if="k.judul" class="text-sm font-medium text-slate-800">{{ k.judul }}</p>
                  <p class="text-sm text-slate-600 whitespace-pre-wrap">{{ k.isi }}</p>
                  <p class="text-xs text-slate-400 mt-1.5">
                    {{ k.penulisNama ?? 'Anonim' }}
                    <span v-if="!k.disetujui" class="ml-1 text-amber-600 font-medium">· menunggu persetujuan</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

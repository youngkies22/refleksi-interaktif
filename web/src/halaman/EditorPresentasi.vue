<script setup lang="ts">
import type { DetailPresentasi, TipeSlide } from '@bersama/tipe';
import { computed, onMounted, ref } from 'vue';
import draggable from 'vuedraggable';
import { useRoute, useRouter } from 'vue-router';
import { apiPresentasi, type UbahSlideInput } from '../api/presentasi.js';
import { GalatApi } from '../api/klien.js';
import FormSlide from '../komponen/editor/FormSlide.vue';
import PemilihTipeSlide from '../komponen/editor/PemilihTipeSlide.vue';
import { META_TIPE, type MetaTipe } from '../komponen/slide/metaTipe.js';
import TombolKembali from '../komponen/umum/TombolKembali.vue';

// vuedraggable tidak mengekspos tipe generik untuk slot #item, jadi `element`
// datang sebagai `any` di template. Fungsi kecil ini memaksa TS memeriksa
// argumennya sebagai TipeSlide di titik pemanggilan, alih-alih membiarkan
// pengindeksan Record langsung dengan nilai `any` di dalam template.
function metaTipe(tipe: TipeSlide): MetaTipe {
  return META_TIPE[tipe];
}

const route = useRoute();
const router = useRouter();
const presentasiId = Number(route.params.id);

const presentasi = ref<DetailPresentasi | null>(null);
const memuat = ref(true);
const galat = ref('');
const slideDipilihId = ref<number | null>(null);
const tampilkanPemilih = ref(false);
const menyimpan = ref(false);
const pesanSimpan = ref('');

const slideDipilih = computed(() => presentasi.value?.slide.find((s) => s.id === slideDipilihId.value) ?? null);

// vuedraggable butuh v-model yang bisa ditulis; computed dengan getter/setter
// membuat urutan lokal langsung reaktif dan tetap sinkron ke `presentasi.value`.
const daftarSlide = computed({
  get: () => presentasi.value?.slide ?? [],
  set: (baru) => {
    if (presentasi.value) presentasi.value.slide = baru;
  },
});

async function muat(): Promise<void> {
  memuat.value = true;
  galat.value = '';
  try {
    const r = await apiPresentasi.detail(presentasiId);
    presentasi.value = r.presentasi;
    if (!slideDipilihId.value && r.presentasi.slide.length > 0) {
      slideDipilihId.value = r.presentasi.slide[0]!.id;
    }
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat presentasi.';
  } finally {
    memuat.value = false;
  }
}

onMounted(muat);

async function tambahSlide(tipe: TipeSlide, gambarPath?: string): Promise<void> {
  tampilkanPemilih.value = false;
  try {
    const r = await apiPresentasi.tambahSlide(presentasiId, tipe);

    // Jika pin_jawaban dengan gambar, langsung set gambar pada slide
    if (tipe === 'pin_jawaban' && gambarPath) {
      await apiPresentasi.ubahSlide(r.id, { konfig: { gambar_path: gambarPath } });
    }

    await muat();
    slideDipilihId.value = r.id;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menambah slide.';
  }
}

async function hapusSlide(id: number): Promise<void> {
  if (!confirm('Hapus slide ini? Tindakan tidak bisa dibatalkan.')) return;
  try {
    await apiPresentasi.hapusSlide(id);
    if (slideDipilihId.value === id) slideDipilihId.value = null;
    await muat();
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menghapus slide.';
  }
}

async function urutanBerubah(): Promise<void> {
  if (!presentasi.value) return;
  try {
    await apiPresentasi.urutkanSlide(presentasiId, presentasi.value.slide.map((s) => s.id));
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menyimpan urutan slide.';
    await muat(); // urutan lokal mungkin sudah menyimpang dari server — muat ulang untuk sinkron
  }
}

async function simpanSlide(payload: UbahSlideInput): Promise<void> {
  if (!slideDipilih.value) return;
  menyimpan.value = true;
  pesanSimpan.value = '';
  try {
    await apiPresentasi.ubahSlide(slideDipilih.value.id, payload);
    await muat();
    pesanSimpan.value = 'Tersimpan.';
    setTimeout(() => (pesanSimpan.value = ''), 2000);
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menyimpan slide.';
  } finally {
    menyimpan.value = false;
  }
}
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
        <h1 class="font-semibold text-slate-800">{{ presentasi?.judul ?? 'Memuat...' }}</h1>
      </div>
      <div class="flex items-center gap-2">
        <RouterLink
          :to="`/presentasi/${presentasiId}/riwayat`"
          class="rounded-lg border border-slate-300 text-slate-600 text-sm font-medium px-4 py-2 hover:bg-slate-50 hover:border-slate-400 transition-colors"
        >
          📊 Riwayat & Unduh
        </RouterLink>
        <RouterLink
          v-if="presentasi && presentasi.slide.length > 0"
          :to="`/presentasi/${presentasiId}/mulai`"
          class="rounded-lg bg-green-600 text-white text-sm font-semibold px-4 py-2 hover:bg-green-700 transition-colors"
        >
          Mulai Sesi
        </RouterLink>
      </div>
    </header>

    <p v-if="galat" class="max-w-5xl mx-auto mt-4 px-4 text-sm text-red-600">{{ galat }}</p>

    <main v-if="memuat" class="max-w-5xl mx-auto px-6 py-10 text-slate-400">Memuat presentasi...</main>

    <main v-else-if="presentasi" class="max-w-5xl mx-auto px-6 py-8 grid grid-cols-[280px_1fr] gap-6">
      <!-- Daftar slide -->
      <aside class="space-y-3">
        <draggable v-model="daftarSlide" item-key="id" handle=".pegangan-slide" class="space-y-2" @end="urutanBerubah">
          <template #item="{ element: s }">
            <div
              class="group flex items-center gap-2 rounded-xl border p-3 cursor-pointer transition-colors"
              :class="s.id === slideDipilihId ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'"
              @click="slideDipilihId = s.id"
            >
              <span class="pegangan-slide cursor-grab text-slate-300 select-none">⠿</span>
              <span class="text-lg">{{ metaTipe(s.tipe).ikon }}</span>
              <span class="flex-1 text-sm text-slate-600 truncate">{{ s.pertanyaan || metaTipe(s.tipe).label }}</span>
              <button
                type="button"
                class="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"
                @click.stop="hapusSlide(s.id)"
              >
                ✕
              </button>
            </div>
          </template>
        </draggable>

        <button
          type="button"
          class="w-full rounded-xl border-2 border-dashed border-slate-300 text-slate-400 py-3 text-sm hover:border-blue-400 hover:text-blue-500 transition-colors"
          @click="tampilkanPemilih = true"
        >
          + Tambah Slide
        </button>
      </aside>

      <!-- Editor slide terpilih -->
      <section class="bg-white rounded-2xl border border-slate-200 p-6">
        <template v-if="slideDipilih">
          <FormSlide :slide="slideDipilih" :menyimpan="menyimpan" @simpan="simpanSlide" />
          <p v-if="pesanSimpan" class="text-sm text-green-600 mt-3">{{ pesanSimpan }}</p>
        </template>
        <p v-else class="text-slate-400 text-center py-12">
          {{ presentasi.slide.length === 0 ? 'Belum ada slide. Klik "+ Tambah Slide" untuk mulai.' : 'Pilih slide di sebelah kiri.' }}
        </p>
      </section>
    </main>

    <PemilihTipeSlide v-if="tampilkanPemilih" @pilih="(tipe, gambar) => tambahSlide(tipe, gambar)" @tutup="tampilkanPemilih = false" />
  </div>
</template>

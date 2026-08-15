<script setup lang="ts">
import type { AreaBenar, Slide } from '@bersama/tipe';
import { BATAS } from '@bersama/konstanta';
import { computed, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import { apiUnggah } from '../../api/unggah.js';
import type { UbahSlideInput } from '../../api/presentasi.js';
import { GalatApi } from '../../api/klien.js';
import { META_TIPE } from '../slide/metaTipe.js';
import EditorAreaGambar from './EditorAreaGambar.vue';

const props = defineProps<{ slide: Slide; presentasiId: number; menyimpan: boolean }>();
const emit = defineEmits<{ simpan: [payload: UbahSlideInput] }>();

const meta = computed(() => META_TIPE[props.slide.tipe]);

let urutanIdBerikut = 0;
/** `_id` LOKAL (bukan id database) — kunci stabil untuk drag & v-for, terpisah
 * dari `teks` yang sedang diketik. Sebelumnya `item-key` memakai `teks`
 * langsung, jadi kunci berubah tiap huruf diketik dan dua opsi kosong baru
 * (teks="") saling bertabrakan — itu sebab drag & fokus input jadi kacau. */
interface OpsiEdit {
  _id: number;
  teks: string;
  benar: boolean;
}
const pertanyaan = ref('');
const opsi = ref<OpsiEdit[]>([]);
const konfigBatasDetik = ref(20);
const konfigMin = ref(1);
const konfigMaks = ref(5);
const konfigLabelMin = ref('');
const konfigLabelMaks = ref('');
const konfigMaksKata = ref(3);
const konfigJawabanDiterima = ref(''); // satu baris = satu jawaban alternatif
const konfigCocokPersis = ref(false);
const konfigPoinParsial = ref(true);
const konfigGambarPath = ref(''); // untuk pin_jawaban: gambar yang di-mark area jawaban
const konfigAreaBenar = ref<AreaBenar | undefined>(undefined);
const konfigGambarPertanyaan = ref(''); // untuk semua tipe: gambar pertanyaan
const mengunggah = ref(false);
const galatUnggah = ref('');
const mengunggahGambarPertanyaan = ref(false);
const galatUnggahGambarPertanyaan = ref('');

function muatDariSlide(s: Slide): void {
  pertanyaan.value = s.pertanyaan;
  opsi.value = s.opsi.map((o) => ({ _id: urutanIdBerikut++, teks: o.teks, benar: o.benar ?? false }));
  konfigBatasDetik.value = s.konfig.batas_detik ?? 20;
  konfigMin.value = s.konfig.min ?? 1;
  konfigMaks.value = s.konfig.maks ?? 5;
  konfigLabelMin.value = s.konfig.label_min ?? '';
  konfigLabelMaks.value = s.konfig.label_maks ?? '';
  konfigMaksKata.value = s.konfig.maks_kata ?? 3;
  konfigJawabanDiterima.value = (s.konfig.jawaban_diterima ?? []).join('\n');
  konfigCocokPersis.value = s.konfig.cocok_persis ?? false;
  konfigPoinParsial.value = s.konfig.poin_parsial ?? true;
  konfigGambarPath.value = s.konfig.gambar_path ?? '';
  konfigAreaBenar.value = s.konfig.area_benar;
  konfigGambarPertanyaan.value = (s.konfig as any).gambar_pertanyaan ?? '';
}

async function unggahGambar(e: Event): Promise<void> {
  const berkas = (e.target as HTMLInputElement).files?.[0];
  if (!berkas) return;
  await prosesUnggahGambar(berkas);
}

function onDropGambar(e: DragEvent): void {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.classList.remove('border-blue-400', 'bg-blue-50');
  const berkas = e.dataTransfer?.files?.[0];
  if (berkas) prosesUnggahGambar(berkas);
}

async function prosesUnggahGambar(berkas: File): Promise<void> {
  // Validasi tipe file
  const tipeYangDiizinkan = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!tipeYangDiizinkan.includes(berkas.type)) {
    galatUnggah.value = 'Tipe file tidak didukung. Gunakan PNG, JPEG, WebP, atau GIF.';
    return;
  }

  // Validasi ukuran (max 50 MB) — hasil akhir dikompres otomatis di server
  // sampai sekitar 1 MB, jadi batas ini cuma jaring pengaman berkas mentah.
  const MAX_SIZE = 50 * 1024 * 1024;
  if (berkas.size > MAX_SIZE) {
    galatUnggah.value = `Ukuran file terlalu besar. Maksimal 50 MB, file ini ${(berkas.size / 1024 / 1024).toFixed(1)} MB.`;
    return;
  }

  mengunggah.value = true;
  galatUnggah.value = '';
  try {
    const r = await apiUnggah.gambar(berkas, { presentasiId: props.presentasiId, slideId: props.slide.id });
    konfigGambarPath.value = r.path;
    konfigAreaBenar.value = undefined; // gambar baru, area lama tidak relevan lagi
  } catch (e) {
    galatUnggah.value = e instanceof GalatApi ? e.message : 'Gagal mengunggah gambar.';
  } finally {
    mengunggah.value = false;
  }
}

async function unggahGambarPertanyaan(e: Event): Promise<void> {
  const berkas = (e.target as HTMLInputElement).files?.[0];
  if (!berkas) return;
  await prosesUnggahGambarPertanyaan(berkas);
}

function onDropGambarPertanyaan(e: DragEvent): void {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.classList.remove('border-blue-400', 'bg-blue-50');
  const berkas = e.dataTransfer?.files?.[0];
  if (berkas) prosesUnggahGambarPertanyaan(berkas);
}

async function prosesUnggahGambarPertanyaan(berkas: File): Promise<void> {
  // Validasi tipe file
  const tipeYangDiizinkan = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!tipeYangDiizinkan.includes(berkas.type)) {
    galatUnggahGambarPertanyaan.value = 'Tipe file tidak didukung. Gunakan PNG, JPEG, WebP, atau GIF.';
    return;
  }

  // Validasi ukuran (max 50 MB) — hasil akhir dikompres otomatis di server
  // sampai sekitar 1 MB, jadi batas ini cuma jaring pengaman berkas mentah.
  const MAX_SIZE = 50 * 1024 * 1024;
  if (berkas.size > MAX_SIZE) {
    galatUnggahGambarPertanyaan.value = `Ukuran file terlalu besar. Maksimal 50 MB.`;
    return;
  }

  mengunggahGambarPertanyaan.value = true;
  galatUnggahGambarPertanyaan.value = '';
  try {
    const r = await apiUnggah.gambar(berkas, { presentasiId: props.presentasiId, slideId: props.slide.id });
    konfigGambarPertanyaan.value = r.path;
  } catch (e) {
    galatUnggahGambarPertanyaan.value = e instanceof GalatApi ? e.message : 'Gagal mengunggah gambar.';
  } finally {
    mengunggahGambarPertanyaan.value = false;
  }
}

async function hapusGambarPertanyaan(): Promise<void> {
  if (!konfigGambarPertanyaan.value) return;
  // Hapus dari S3/disk secara silent (jangan tampil error ke user)
  await apiUnggah.hapusGambar(konfigGambarPertanyaan.value).catch(() => {});
  konfigGambarPertanyaan.value = '';
}

watch(() => props.slide.id, () => muatDariSlide(props.slide), { immediate: true });

function tambahOpsi(): void {
  opsi.value.push({ _id: urutanIdBerikut++, teks: '', benar: false });
}

function hapusOpsi(i: number): void {
  opsi.value.splice(i, 1);
}

/** Untuk kuis, jawaban benar cuma boleh satu — centang yang baru otomatis melepas yang lama. */
function pilihBenar(i: number): void {
  opsi.value.forEach((o, j) => (o.benar = j === i));
}

function simpan(): void {
  const payload: UbahSlideInput = {
    pertanyaan: pertanyaan.value,
    konfig: {
      // Gambar pertanyaan bisa di semua tipe soal
      ...(konfigGambarPertanyaan.value ? { gambar_pertanyaan: konfigGambarPertanyaan.value } : {}),
      ...(meta.value.keluarga === 'kahoot' ? { batas_detik: konfigBatasDetik.value } : {}),
      ...(props.slide.tipe === 'skala'
        ? { min: konfigMin.value, maks: konfigMaks.value, label_min: konfigLabelMin.value, label_maks: konfigLabelMaks.value }
        : {}),
      ...(props.slide.tipe === 'wordcloud' ? { maks_kata: konfigMaksKata.value } : {}),
      ...(props.slide.tipe === 'ketik_jawaban'
        ? {
            jawaban_diterima: konfigJawabanDiterima.value
              .split('\n')
              .map((x) => x.trim())
              .filter((x) => x !== ''),
            cocok_persis: konfigCocokPersis.value,
          }
        : {}),
      ...(props.slide.tipe === 'puzzle' ? { poin_parsial: konfigPoinParsial.value } : {}),
      ...(props.slide.tipe === 'pin_jawaban'
        ? { gambar_path: konfigGambarPath.value || undefined, area_benar: konfigAreaBenar.value }
        : {}),
    },
  };

  if (meta.value.butuhOpsi) {
    payload.opsi = opsi.value.map((o) => ({ teks: o.teks, benar: o.benar }));
  }

  emit('simpan', payload);
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-2 text-sm text-slate-500">
      <span class="text-lg">{{ meta.ikon }}</span>
      <span class="font-medium text-slate-700">{{ meta.label }}</span>
      <span class="text-slate-400">— {{ meta.keterangan }}</span>
    </div>

    <!-- Pertanyaan dengan opsional gambar -->
    <div class="space-y-3">
      <label class="block text-sm font-medium text-slate-600 mb-1">Pertanyaan</label>
      <textarea
        v-model="pertanyaan"
        rows="2"
        :maxlength="BATAS.pertanyaan"
        class="w-full rounded-lg border border-slate-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Tulis pertanyaan untuk slide ini..."
      />
      <p class="text-xs text-slate-400">{{ pertanyaan.length }}/{{ BATAS.pertanyaan }}</p>

      <!-- Upload gambar untuk pertanyaan -->
      <div class="space-y-3 pt-2 border-t border-slate-200">
        <label class="block text-sm font-medium text-slate-700">📸 Gambar Pertanyaan (Opsional)</label>

        <!-- Preview gambar -->
        <div v-if="konfigGambarPertanyaan" class="space-y-2">
          <div class="relative inline-block max-w-full">
            <img :src="konfigGambarPertanyaan" class="max-h-48 max-w-full rounded-xl border-2 border-blue-300 bg-blue-50" />
            <button
              type="button"
              class="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm leading-none shadow-md transition-colors"
              title="Hapus gambar"
              @click="hapusGambarPertanyaan"
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            class="text-xs text-slate-500 hover:text-blue-600 transition-colors"
            @click="hapusGambarPertanyaan"
          >
            🔄 Ganti gambar
          </button>
        </div>

        <!-- Upload area -->
        <div v-else class="space-y-2">
          <div
            class="relative border-2 border-dashed border-slate-300 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            @click="($refs.inputGambarPertanyaan as any)?.click?.()"
            @dragover.prevent="(e) => (e.currentTarget as HTMLElement).classList.add('border-blue-400', 'bg-blue-50')"
            @dragleave.prevent="(e) => (e.currentTarget as HTMLElement).classList.remove('border-blue-400', 'bg-blue-50')"
            @drop="onDropGambarPertanyaan"
          >
            <input
              ref="inputGambarPertanyaan"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              class="hidden"
              :disabled="mengunggahGambarPertanyaan"
              @change="unggahGambarPertanyaan"
            />
            <div v-if="!mengunggahGambarPertanyaan" class="space-y-1">
              <p class="text-2xl">🖼️</p>
              <p class="text-sm font-medium text-slate-700">Klik atau tarik gambar di sini</p>
              <p class="text-xs text-slate-500">PNG, JPEG, WebP, GIF</p>
            </div>
            <div v-else class="space-y-1">
              <p class="text-2xl">⏳</p>
              <p class="text-sm font-medium text-slate-600">Mengunggah gambar...</p>
            </div>
          </div>
          <p v-if="galatUnggahGambarPertanyaan" class="text-xs text-red-600 bg-red-50 rounded-lg p-2 flex items-start gap-2">
            <span>⚠️</span>
            <span>{{ galatUnggahGambarPertanyaan }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Konfigurasi Kahoot: timer -->
    <div v-if="meta.keluarga === 'kahoot'" class="flex items-center gap-3">
      <label class="text-sm font-medium text-slate-600">Batas waktu</label>
      <input
        v-model.number="konfigBatasDetik"
        type="number"
        min="5"
        max="120"
        class="w-24 rounded-lg border border-slate-300 py-1.5 px-2"
      />
      <span class="text-sm text-slate-400">detik</span>
    </div>

    <!-- Skala -->
    <div v-if="slide.tipe === 'skala'" class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">Nilai minimum</label>
        <input v-model.number="konfigMin" type="number" class="w-full rounded-lg border border-slate-300 py-2 px-3" />
        <input v-model="konfigLabelMin" placeholder="Label (opsional)" class="w-full mt-1 rounded-lg border border-slate-300 py-1.5 px-3 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">Nilai maksimum</label>
        <input v-model.number="konfigMaks" type="number" class="w-full rounded-lg border border-slate-300 py-2 px-3" />
        <input v-model="konfigLabelMaks" placeholder="Label (opsional)" class="w-full mt-1 rounded-lg border border-slate-300 py-1.5 px-3 text-sm" />
      </div>
    </div>

    <!-- Word cloud -->
    <div v-if="slide.tipe === 'wordcloud'" class="flex items-center gap-3">
      <label class="text-sm font-medium text-slate-600">Maksimal kata per peserta</label>
      <input v-model.number="konfigMaksKata" type="number" min="1" max="5" class="w-20 rounded-lg border border-slate-300 py-1.5 px-2" />
    </div>

    <!-- Ketik jawaban -->
    <div v-if="slide.tipe === 'ketik_jawaban'" class="space-y-2">
      <label class="block text-sm font-medium text-slate-600">Jawaban yang diterima (satu per baris)</label>
      <textarea
        v-model="konfigJawabanDiterima"
        rows="3"
        class="w-full rounded-lg border border-slate-300 py-2 px-3 font-mono text-sm"
        placeholder="fotosintesis&#10;foto sintesis"
      />
      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input v-model="konfigCocokPersis" type="checkbox" class="rounded" />
        Harus cocok persis (matikan toleransi salah ketik)
      </label>
    </div>

    <!-- Puzzle -->
    <div v-if="slide.tipe === 'puzzle'">
      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input v-model="konfigPoinParsial" type="checkbox" class="rounded" />
        Beri poin parsial untuk urutan yang setengah benar
      </label>
    </div>

    <!-- Pin di gambar -->
    <div v-if="slide.tipe === 'pin_jawaban'" class="space-y-4">
      <div v-if="!konfigGambarPath" class="space-y-3">
        <label class="block text-sm font-medium text-slate-700 mb-2">📸 Unggah Gambar Pertanyaan</label>
        <div
          class="relative border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
          @click="($refs.inputGambar as any)?.click?.()"
          @dragover.prevent="(e) => (e.currentTarget as HTMLElement).classList.add('border-blue-400', 'bg-blue-50')"
          @dragleave.prevent="(e) => (e.currentTarget as HTMLElement).classList.remove('border-blue-400', 'bg-blue-50')"
          @drop="onDropGambar"
        >
          <input
            ref="inputGambar"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            :disabled="mengunggah"
            class="hidden"
            @change="unggahGambar"
          />
          <div v-if="!mengunggah" class="space-y-2">
            <p class="text-3xl">🖼️</p>
            <p class="text-sm font-medium text-slate-700">Klik atau tarik gambar ke sini</p>
            <p class="text-xs text-slate-500">PNG, JPEG, WebP, atau GIF</p>
          </div>
          <div v-else class="space-y-2">
            <p class="text-2xl">⏳</p>
            <p class="text-sm font-medium text-slate-600">Mengunggah gambar...</p>
          </div>
        </div>
        <p v-if="galatUnggah" class="text-sm text-red-600 bg-red-50 rounded-lg p-3 flex items-start gap-2">
          <span>⚠️</span>
          <span>{{ galatUnggah }}</span>
        </p>
      </div>
      <template v-else>
        <div class="space-y-3">
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-medium text-slate-700">✅ Gambar Sudah Diunggah</label>
            <button
              type="button"
              class="text-xs font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              @click="konfigGambarPath = ''"
            >
              🔄 Ganti Gambar
            </button>
          </div>
          <EditorAreaGambar :gambar-path="konfigGambarPath" :area="konfigAreaBenar" @ubah="(a) => (konfigAreaBenar = a)" />
          <p v-if="!konfigAreaBenar" class="text-sm text-amber-600 bg-amber-50 rounded-lg p-3 flex items-start gap-2">
            <span>⚠️</span>
            <span>Klik & tarik pada gambar untuk menandai area jawaban yang benar</span>
          </p>
          <div v-else class="text-sm text-emerald-600 bg-emerald-50 rounded-lg p-3 flex items-start gap-2">
            <span>✓</span>
            <span>Area jawaban sudah ditandai</span>
          </div>
        </div>
      </template>
    </div>

    <!-- Opsi tetap (benar/salah) — guru pilih mana yang BENAR untuk pernyataannya -->
    <div v-if="meta.opsiTetap">
      <label class="block text-sm font-medium text-slate-600 mb-2">
        Untuk pernyataan ini, jawaban yang benar adalah:
      </label>
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="(o, i) in opsi"
          :key="o._id"
          type="button"
          class="rounded-2xl border-2 py-4 font-semibold transition-all"
          :class="o.benar ? 'border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm' : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'"
          @click="pilihBenar(i)"
        >
          <span v-if="o.benar" class="mr-1">✓</span>{{ o.teks }}
        </button>
      </div>
    </div>

    <!-- Editor opsi (drag urutkan, tambah/hapus, tandai benar) -->
    <div v-else-if="meta.butuhOpsi">
      <div class="flex items-center justify-between mb-3">
        <label class="text-sm font-medium text-slate-600">
          Opsi
          <span v-if="slide.tipe === 'puzzle'" class="text-slate-400 font-normal">— urutan di sini = kunci jawaban</span>
        </label>
        <span class="text-xs text-slate-400">{{ opsi.length }} opsi</span>
      </div>

      <draggable v-model="opsi" item-key="_id" handle=".pegangan" class="space-y-2" ghost-class="opacity-40">
        <template #item="{ element: o, index: i }">
          <div class="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white pl-1 pr-2 py-1.5 transition-colors focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
            <span class="pegangan shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 select-none w-5 text-center text-base">⠿</span>
            <button
              v-if="slide.tipe === 'kuis'"
              type="button"
              class="shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs transition-colors"
              :class="o.benar ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'"
              :title="o.benar ? 'Jawaban benar' : 'Tandai sebagai jawaban benar'"
              @click="pilihBenar(i)"
            >
              ✓
            </button>
            <input
              v-model="o.teks"
              type="text"
              :maxlength="BATAS.opsiTeks"
              class="flex-1 min-w-0 rounded-lg border-0 py-1.5 px-2 text-sm focus:outline-none focus:ring-0"
              :placeholder="`Opsi ${i + 1}`"
            />
            <button
              type="button"
              class="shrink-0 w-6 h-6 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              title="Hapus opsi"
              @click="hapusOpsi(i)"
            >
              ✕
            </button>
          </div>
        </template>
      </draggable>

      <button
        type="button"
        class="w-full mt-2 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 text-sm py-2 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50 transition-colors"
        @click="tambahOpsi"
      >
        + Tambah opsi
      </button>
    </div>

    <div class="pt-2 border-t border-slate-100">
      <button
        type="button"
        :disabled="menyimpan"
        class="rounded-lg bg-blue-600 text-white text-sm font-semibold px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
        @click="simpan"
      >
        {{ menyimpan ? 'Menyimpan...' : 'Simpan Slide' }}
      </button>
    </div>
  </div>
</template>

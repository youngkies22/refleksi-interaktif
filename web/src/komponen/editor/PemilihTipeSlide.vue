<script setup lang="ts">
import type { TipeSlide } from '@bersama/tipe';
import { ref } from 'vue';
import { apiUnggah } from '../../api/unggah.js';
import { GalatApi } from '../../api/klien.js';
import { DAFTAR_TIPE, META_TIPE } from '../slide/metaTipe.js';

const props = defineProps<{ presentasiId: number }>();
const emit = defineEmits<{ pilih: [tipe: TipeSlide, gambarPath?: string]; tutup: [] }>();

const tipeDipilih = ref<TipeSlide | null>(null);
const mengunggah = ref(false);
const galatUnggah = ref('');
const gambarPath = ref('');

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
    galatUnggah.value = `Ukuran file terlalu besar. Maksimal 50 MB.`;
    return;
  }

  mengunggah.value = true;
  galatUnggah.value = '';
  try {
    const r = await apiUnggah.gambar(berkas, { presentasiId: props.presentasiId });
    gambarPath.value = r.path;
  } catch (e) {
    galatUnggah.value = e instanceof GalatApi ? e.message : 'Gagal mengunggah gambar.';
  } finally {
    mengunggah.value = false;
  }
}

function pilihTipe(tipe: TipeSlide): void {
  if (tipe === 'pin_jawaban') {
    tipeDipilih.value = tipe;
  } else {
    emit('pilih', tipe);
  }
}

function konfirmasiBuatSlide(): void {
  if (tipeDipilih.value) {
    emit('pilih', tipeDipilih.value, gambarPath.value || undefined);
  }
}

function batalkan(): void {
  tipeDipilih.value = null;
  gambarPath.value = '';
  galatUnggah.value = '';
  mengunggah.value = false;
  emit('tutup');
}

function kembaliKePilihan(): void {
  tipeDipilih.value = null;
  gambarPath.value = '';
  galatUnggah.value = '';
}
</script>

<template>
  <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 px-4 py-6" @click.self="batalkan">
    <div class="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <!-- Header -->
      <div class="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-6 rounded-t-3xl">
        <h2 v-if="!tipeDipilih" class="text-2xl font-bold">Pilih Tipe Slide</h2>
        <h2 v-else class="text-2xl font-bold flex items-center gap-2">
          <span>{{ META_TIPE[tipeDipilih].ikon }}</span>
          {{ META_TIPE[tipeDipilih].label }}
        </h2>
        <p v-if="!tipeDipilih" class="text-blue-100 text-sm mt-1">Pilih jenis pertanyaan yang ingin ditampilkan</p>
      </div>

      <div class="p-8 space-y-6">
        <!-- Grid tipe slide -->
        <div v-if="!tipeDipilih" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            v-for="tipe in DAFTAR_TIPE"
            :key="tipe"
            type="button"
            class="group relative overflow-hidden text-left rounded-2xl border-2 border-slate-200 p-5 hover:border-blue-400 hover:bg-blue-50 transition-all hover:shadow-lg active:scale-95"
            @click="pilihTipe(tipe)"
          >
            <!-- Background gradient on hover -->
            <div class="absolute inset-0 bg-gradient-to-br from-blue-400/0 to-blue-500/0 group-hover:from-blue-400/10 group-hover:to-blue-500/10 transition-all" />

            <div class="relative space-y-2">
              <span class="block text-4xl">{{ META_TIPE[tipe].ikon }}</span>
              <div>
                <span class="block text-sm font-bold text-slate-800">{{ META_TIPE[tipe].label }}</span>
                <span class="block text-xs text-slate-500 mt-1">{{ META_TIPE[tipe].keterangan }}</span>
                <span v-if="tipe === 'pin_jawaban'" class="inline-block mt-2 px-2 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-lg">
                  📸 Upload Gambar
                </span>
              </div>
            </div>
          </button>
        </div>

        <!-- Upload area untuk pin_jawaban -->
        <div v-else-if="tipeDipilih === 'pin_jawaban'" class="space-y-6">
          <div v-if="!gambarPath" class="space-y-4">
            <p class="text-slate-600 text-sm">Silakan unggah gambar untuk slide ini. Guru akan menandai area jawaban yang benar setelah slide dibuat.</p>

            <!-- Drag-drop upload area -->
            <div
              class="relative border-3 border-dashed border-blue-300 rounded-3xl p-12 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all"
              @click="($refs.inputGambar as any)?.click?.()"
              @dragover.prevent="(e) => (e.currentTarget as HTMLElement).classList.add('border-blue-500', 'bg-blue-50')"
              @dragleave.prevent="(e) => (e.currentTarget as HTMLElement).classList.remove('border-blue-500', 'bg-blue-50')"
              @drop="onDropGambar"
            >
              <input
                ref="inputGambar"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                class="hidden"
                :disabled="mengunggah"
                @change="unggahGambar"
              />
              <div v-if="!mengunggah" class="space-y-3">
                <p class="text-5xl">🖼️</p>
                <div>
                  <p class="text-lg font-bold text-slate-800">Klik atau tarik gambar di sini</p>
                  <p class="text-sm text-slate-500 mt-1">PNG, JPEG, WebP, atau GIF</p>
                </div>
              </div>
              <div v-else class="space-y-3">
                <p class="text-4xl">⏳</p>
                <p class="text-lg font-semibold text-slate-600">Mengunggah gambar...</p>
              </div>
            </div>

            <!-- Error message -->
            <div v-if="galatUnggah" class="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-start gap-3">
              <span class="text-2xl">⚠️</span>
              <div>
                <p class="font-semibold text-red-700">Gagal Unggah</p>
                <p class="text-sm text-red-600 mt-1">{{ galatUnggah }}</p>
              </div>
            </div>
          </div>

          <!-- Preview gambar -->
          <div v-else class="space-y-4">
            <div class="rounded-2xl overflow-hidden bg-slate-100 p-4 flex justify-center max-h-96">
              <img :src="gambarPath" alt="Preview" class="max-h-full max-w-full object-contain rounded-xl" />
            </div>

            <div class="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
              <span class="text-2xl">✅</span>
              <div>
                <p class="font-semibold text-emerald-700">Gambar Berhasil Diunggah</p>
                <p class="text-sm text-emerald-600 mt-1">Gambar siap digunakan. Anda dapat menandai area jawaban setelah slide dibuat.</p>
              </div>
            </div>

            <button
              type="button"
              class="w-full text-sm text-slate-500 hover:text-blue-600 transition-colors py-2"
              @click="gambarPath = ''"
            >
              🔄 Ganti Gambar
            </button>
          </div>
        </div>
      </div>

      <!-- Footer dengan tombol aksi -->
      <div class="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-8 py-5 rounded-b-3xl flex gap-3 justify-end">
        <button
          type="button"
          class="px-6 py-2.5 text-slate-600 font-semibold hover:bg-slate-200 rounded-xl transition-colors"
          @click="tipeDipilih ? kembaliKePilihan() : batalkan()"
        >
          {{ tipeDipilih ? '← Kembali' : 'Batal' }}
        </button>
        <button
          v-if="tipeDipilih === 'pin_jawaban' && gambarPath"
          type="button"
          class="px-6 py-2.5 bg-emerald-600 text-white font-semibold hover:bg-emerald-700 rounded-xl transition-colors active:scale-95 flex items-center gap-2"
          @click="konfirmasiBuatSlide"
        >
          <span>✓</span> Buat Slide
        </button>
      </div>
    </div>
  </div>
</template>

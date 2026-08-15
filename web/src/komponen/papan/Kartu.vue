<script setup lang="ts">
import type { Kartu, Komentar } from '@bersama/tipe';
import { BATAS } from '@bersama/konstanta';
import { onUnmounted, ref, watch } from 'vue';
import { apiPapan } from '../../api/papan.js';

const props = defineProps<{
  kartu: Kartu;
  izinkanLike: boolean;
  izinkanKomentar: boolean;
}>();
const emit = defineEmits<{
  like: [kartuId: number];
  komentar: [kartuId: number, isi: string];
  hapus: [kartuId: number];
}>();

const WARNA_BG: Record<string, string> = {
  kuning: 'bg-amber-100 border-amber-200',
  biru: 'bg-blue-100 border-blue-200',
  hijau: 'bg-emerald-100 border-emerald-200',
  merah: 'bg-red-100 border-red-200',
  ungu: 'bg-purple-100 border-purple-200',
};

const komentarTerbuka = ref(false);
const daftarKomentar = ref<Komentar[] | null>(null);
const isiKomentar = ref('');
const lightboxTerbuka = ref(false);

function tutupLightboxViaTombolEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') lightboxTerbuka.value = false;
}
watch(lightboxTerbuka, (terbuka) => {
  if (terbuka) window.addEventListener('keydown', tutupLightboxViaTombolEsc);
  else window.removeEventListener('keydown', tutupLightboxViaTombolEsc);
});
onUnmounted(() => window.removeEventListener('keydown', tutupLightboxViaTombolEsc));

async function muatKomentar(): Promise<void> {
  const r = await apiPapan.komentarKartu(props.kartu.id);
  daftarKomentar.value = r.komentar;
}

async function bukaKomentar(): Promise<void> {
  komentarTerbuka.value = !komentarTerbuka.value;
  if (komentarTerbuka.value && daftarKomentar.value === null) await muatKomentar();
}

function kirimKomentar(): void {
  if (isiKomentar.value.trim() === '') return;
  emit('komentar', props.kartu.id, isiKomentar.value);
  isiKomentar.value = '';
}

// jumlahKomentar berubah (dari siapa pun, lewat siaran socket di Papan.vue)
// SAAT thread ini sedang terbuka → muat ulang, tanpa perlu parent mengorkestrasi
// mana komponen Kartu yang harus diperbarui.
watch(
  () => props.kartu.jumlahKomentar,
  () => {
    if (komentarTerbuka.value) void muatKomentar();
  },
);
</script>

<template>
  <div
    class="rounded-xl border p-3 shadow-sm"
    :class="[WARNA_BG[kartu.warna] ?? WARNA_BG.kuning, !kartu.disetujui ? 'opacity-60' : '']"
  >
    <p v-if="!kartu.disetujui" class="text-xs text-amber-600 font-medium mb-1">⏳ Menunggu persetujuan guru</p>

    <h3 v-if="kartu.judul" class="font-semibold text-slate-800 text-sm mb-1">{{ kartu.judul }}</h3>
    <p class="text-slate-700 text-sm whitespace-pre-wrap">{{ kartu.isi }}</p>

    <button
      v-if="kartu.lampiranPath"
      type="button"
      class="group relative mt-2 block w-full overflow-hidden rounded-lg bg-black/5"
      title="Klik untuk memperbesar"
      @click="lightboxTerbuka = true"
    >
      <img
        :src="kartu.lampiranPath"
        class="h-40 sm:h-52 w-full object-contain transition-transform group-hover:scale-105"
      />
      <span
        class="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100"
      >
        <span class="rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white">🔍 Perbesar</span>
      </span>
    </button>

    <div class="flex items-center justify-between mt-1 text-xs text-slate-500">
      <span class="truncate">{{ kartu.penulisNama || 'Anonim' }}</span>
      <div class="flex items-center -mr-1.5">
        <button
          v-if="izinkanLike"
          type="button"
          class="inline-flex items-center gap-1 py-2 px-2 rounded-lg hover:text-red-500 active:bg-black/10 transition-colors"
          @click="emit('like', kartu.id)"
        >
          👍 {{ kartu.jumlahLike }}
        </button>
        <button
          v-if="izinkanKomentar"
          type="button"
          class="inline-flex items-center gap-1 py-2 px-2 rounded-lg hover:text-blue-500 active:bg-black/10 transition-colors"
          @click="bukaKomentar"
        >
          💬 {{ kartu.jumlahKomentar }}
        </button>
        <button
          v-if="kartu.milikSaya"
          type="button"
          class="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:text-red-500 active:bg-black/10 transition-colors"
          @click="emit('hapus', kartu.id)"
        >
          ✕
        </button>
      </div>
    </div>

    <div v-if="komentarTerbuka" class="mt-2 pt-2 border-t border-black/10 space-y-1.5">
      <p v-for="k in daftarKomentar" :key="k.id" class="text-xs text-slate-600">
        <b>{{ k.nama || 'Anonim' }}:</b> {{ k.isi }}
      </p>
      <form class="flex gap-1.5 mt-1" @submit.prevent="kirimKomentar">
        <input
          v-model="isiKomentar"
          type="text"
          :maxlength="BATAS.komentar"
          placeholder="Tulis komentar..."
          class="flex-1 text-sm rounded-lg border border-slate-300 py-2 px-2.5"
        />
        <button type="submit" class="text-sm text-blue-600 font-medium px-2 active:scale-95 transition-transform">Kirim</button>
      </form>
    </div>
  </div>

  <!-- Teleport ke body: lightbox tidak boleh terjebak overflow-x-auto kolom
       papan (lihat Papan.vue) atau ke-crop batas kartu. -->
  <Teleport to="body">
    <div
      v-if="lightboxTerbuka"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 sm:p-8"
      @click.self="lightboxTerbuka = false"
    >
      <button
        type="button"
        class="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white text-xl hover:bg-white/20 transition-colors"
        title="Tutup"
        @click="lightboxTerbuka = false"
      >
        ✕
      </button>
      <img
        :src="kartu.lampiranPath ?? undefined"
        class="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
        @click.stop
      />
    </div>
  </Teleport>
</template>

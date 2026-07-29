<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiRekap, type HasilSesi } from '../api/rekap.js';
import { GalatApi } from '../api/klien.js';
import { META_TIPE } from '../komponen/slide/metaTipe.js';
import TombolKembali from '../komponen/umum/TombolKembali.vue';
import type { TipeSlide } from '@bersama/tipe';

const route = useRoute();
const router = useRouter();
const sesiId = Number(route.params.id);

const hasil = ref<HasilSesi | null>(null);
const memuat = ref(true);
const galat = ref('');

onMounted(async () => {
  try {
    const r = await apiRekap.hasil(sesiId);
    hasil.value = r.hasil;
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memuat hasil sesi.';
  } finally {
    memuat.value = false;
  }
});

function metaTipeDari(tipe: string) {
  return META_TIPE[tipe as TipeSlide];
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
        <h1 class="font-semibold text-slate-800">{{ hasil?.judul ?? 'Memuat...' }}</h1>
      </div>
      <a v-if="hasil" :href="apiRekap.urlCsv(sesiId)" class="text-sm text-blue-600 hover:underline">⬇ Unduh CSV</a>
    </header>

    <main v-if="memuat" class="max-w-3xl mx-auto px-6 py-10 text-slate-400">Memuat...</main>
    <p v-else-if="galat" class="max-w-3xl mx-auto px-6 py-10 text-red-600">{{ galat }}</p>

    <main v-else-if="hasil" class="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <section class="bg-white rounded-2xl border border-slate-200 p-6">
        <p class="text-sm text-slate-500">Kode: <span class="font-mono">{{ hasil.kode }}</span></p>
        <p class="text-sm text-slate-500">{{ hasil.jumlahPeserta }} peserta bergabung</p>
        <p class="text-xs text-slate-400 mt-1">Status: {{ hasil.status }}</p>
      </section>

      <section v-if="hasil.leaderboard.length > 0" class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="font-semibold text-slate-700 mb-3">Leaderboard Akhir</h2>
        <div class="space-y-1">
          <div v-for="b in hasil.leaderboard" :key="b.peringkat" class="flex items-center gap-3 text-sm py-1.5 border-b border-slate-100 last:border-0">
            <span class="w-8 font-bold text-blue-600">#{{ b.peringkat }}</span>
            <span class="flex-1">{{ b.nama }}</span>
            <span class="font-mono">{{ b.skor }}</span>
          </div>
        </div>
      </section>

      <section class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="font-semibold text-slate-700 mb-3">Ringkasan per Slide</h2>
        <div v-for="s in hasil.slide" :key="s.slideId" class="py-2 border-b border-slate-100 last:border-0">
          <p class="text-sm font-medium">{{ metaTipeDari(s.tipe).ikon }} {{ s.pertanyaan || '(tanpa pertanyaan)' }}</p>
          <p class="text-xs text-slate-400">
            {{ s.jumlahJawaban }} jawaban
            <span v-if="s.jumlahBenar !== null">· {{ s.jumlahBenar }} benar</span>
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

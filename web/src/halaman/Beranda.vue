<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { GalatApi, panggil } from '../api/klien.js';
import { usePengaturanStore } from '../stores/pengaturan.js';

const pengaturan = usePengaturanStore();
const router = useRouter();
const kode = ref('');
const galat = ref('');
const memeriksa = ref(false);

/** Satu form dipakai untuk dua tujuan (sesi live & papan Padlet) — kode dicek
 *  dulu lewat `/api/kode/:kode` sebelum diarahkan, supaya kode papan tidak
 *  ikut dikirim ke alur sesi (yang akan salah mengaku "kode tidak ditemukan"). */
async function gabung(): Promise<void> {
  const k = kode.value.trim().replace(/\D+/g, '');
  if (k.length !== 6) {
    galat.value = 'Kode terdiri dari 6 angka.';
    return;
  }
  galat.value = '';
  memeriksa.value = true;
  try {
    const r = await panggil<{ tipe: 'sesi' | 'papan' | null }>(`/api/kode/${k}`);
    if (r.tipe === 'papan') await router.push(`/p/${k}`);
    else if (r.tipe === 'sesi') await router.push(`/gabung/${k}`);
    else galat.value = 'Kode tidak ditemukan. Periksa lagi kodenya.';
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memeriksa kode.';
  } finally {
    memeriksa.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <div class="w-full max-w-sm text-center">
      <img v-if="pengaturan.logoUrl" :src="pengaturan.logoUrl" alt="" class="w-14 h-14 rounded-2xl object-cover mx-auto mb-3" />
      <h1 class="text-3xl font-bold text-slate-800 mb-1">{{ pengaturan.namaAplikasi }}</h1>
      <p class="text-slate-500 mb-8">Masukkan kode dari layar guru untuk bergabung</p>

      <form class="space-y-3" @submit.prevent="gabung">
        <input
          v-model="kode"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          placeholder="123456"
          class="w-full text-center text-2xl tracking-[0.3em] font-semibold rounded-xl border border-slate-300 py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p v-if="galat" class="text-sm text-red-600">{{ galat }}</p>
        <button
          type="submit"
          :disabled="memeriksa"
          class="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {{ memeriksa ? 'Memeriksa...' : 'Gabung' }}
        </button>
      </form>

      <RouterLink to="/masuk" class="inline-block mt-8 text-sm text-slate-400 hover:text-slate-600">
        Masuk sebagai guru →
      </RouterLink>
    </div>
  </main>
</template>

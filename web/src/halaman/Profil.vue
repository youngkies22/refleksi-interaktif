<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { GalatApi } from '../api/klien.js';
import TombolKembali from '../komponen/umum/TombolKembali.vue';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const nama = ref(auth.guru?.nama ?? '');
const username = ref(auth.guru?.username ?? '');
const passwordLama = ref('');
const passwordBaru = ref('');
const konfirmasiPasswordBaru = ref('');

const menyimpan = ref(false);
const galat = ref('');
const sukses = ref('');

async function simpan(): Promise<void> {
  galat.value = '';
  sukses.value = '';

  if (passwordBaru.value !== '' && passwordBaru.value !== konfirmasiPasswordBaru.value) {
    galat.value = 'Konfirmasi password baru tidak cocok.';
    return;
  }

  menyimpan.value = true;
  try {
    await auth.ubahProfil({
      nama: nama.value,
      username: username.value,
      passwordLama: passwordBaru.value !== '' ? passwordLama.value : undefined,
      passwordBaru: passwordBaru.value !== '' ? passwordBaru.value : undefined,
    });
    sukses.value = 'Perubahan tersimpan.';
    passwordLama.value = '';
    passwordBaru.value = '';
    konfirmasiPasswordBaru.value = '';
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal menyimpan perubahan.';
  } finally {
    menyimpan.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
      <TombolKembali
        class="text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        title="Dashboard"
        @click="router.push('/dashboard')"
      />
      <h1 class="font-semibold text-slate-800">Profil Saya</h1>
    </header>

    <main class="max-w-md mx-auto px-6 py-10">
      <form class="bg-white rounded-2xl border border-slate-200 p-6 space-y-4" @submit.prevent="simpan">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">Nama</label>
          <input v-model="nama" type="text" class="w-full rounded-lg border border-slate-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">Username</label>
          <input v-model="username" type="text" class="w-full rounded-lg border border-slate-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div class="pt-3 border-t border-slate-100">
          <p class="text-sm font-medium text-slate-600 mb-2">Ganti password (opsional)</p>
          <label class="block text-xs text-slate-500 mb-1">Password lama</label>
          <input v-model="passwordLama" type="password" autocomplete="current-password" class="w-full rounded-lg border border-slate-300 py-2 px-3 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label class="block text-xs text-slate-500 mb-1">Password baru</label>
          <input v-model="passwordBaru" type="password" autocomplete="new-password" class="w-full rounded-lg border border-slate-300 py-2 px-3 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label class="block text-xs text-slate-500 mb-1">Konfirmasi password baru</label>
          <input v-model="konfirmasiPasswordBaru" type="password" autocomplete="new-password" class="w-full rounded-lg border border-slate-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <p v-if="galat" class="text-sm text-red-600">{{ galat }}</p>
        <p v-if="sukses" class="text-sm text-emerald-600">{{ sukses }}</p>

        <button
          type="submit"
          :disabled="menyimpan"
          class="w-full rounded-lg bg-blue-600 text-white font-semibold py-2.5 hover:bg-blue-700 disabled:opacity-50"
        >
          {{ menyimpan ? 'Menyimpan...' : 'Simpan Perubahan' }}
        </button>
      </form>
    </main>
  </div>
</template>

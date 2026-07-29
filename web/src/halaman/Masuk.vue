<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { GalatApi } from '../api/klien.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const username = ref('');
const password = ref('');
const galat = ref('');
const memuat = ref(false);

async function submit(): Promise<void> {
  galat.value = '';
  memuat.value = true;
  try {
    await auth.masuk(username.value, password.value);
    await router.push('/dashboard');
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Terjadi kesalahan tak terduga.';
  } finally {
    memuat.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <form class="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8" @submit.prevent="submit">
      <h1 class="text-xl font-bold text-slate-800 mb-6">Masuk sebagai Guru</h1>

      <label class="block text-sm font-medium text-slate-600 mb-1">Username</label>
      <input
        v-model="username"
        type="text"
        autocomplete="username"
        class="w-full rounded-lg border border-slate-300 py-2 px-3 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <label class="block text-sm font-medium text-slate-600 mb-1">Password</label>
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        class="w-full rounded-lg border border-slate-300 py-2 px-3 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <p v-if="galat" class="text-sm text-red-600 mb-4">{{ galat }}</p>

      <button
        type="submit"
        :disabled="memuat"
        class="w-full rounded-lg bg-blue-600 text-white font-semibold py-2.5 hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {{ memuat ? 'Memproses...' : 'Masuk' }}
      </button>
    </form>
  </main>
</template>

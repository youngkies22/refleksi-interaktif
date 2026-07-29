<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiSesi } from '../api/sesi.js';
import { GalatApi } from '../api/klien.js';
import TombolKembali from '../komponen/umum/TombolKembali.vue';

const route = useRoute();
const router = useRouter();
const galat = ref('');

onMounted(async () => {
  const presentasiId = Number(route.params.id);
  try {
    const r = await apiSesi.mulai(presentasiId);
    await router.replace(`/sesi/${r.kode}/presenter`);
  } catch (e) {
    galat.value = e instanceof GalatApi ? e.message : 'Gagal memulai sesi.';
  }
});
</script>

<template>
  <main class="min-h-screen flex items-center justify-center bg-slate-50 px-4 text-center">
    <div>
      <p v-if="!galat" class="text-slate-400">Memulai sesi...</p>
      <template v-else>
        <p class="text-red-600 mb-3">{{ galat }}</p>
        <TombolKembali
          :to="`/presentasi/${route.params.id}/edit`"
          class="text-blue-600 hover:bg-blue-50"
          title="Kembali ke editor"
        />
      </template>
    </div>
  </main>
</template>

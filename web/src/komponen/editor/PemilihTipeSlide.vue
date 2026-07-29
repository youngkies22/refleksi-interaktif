<script setup lang="ts">
import type { TipeSlide } from '@bersama/tipe';
import { DAFTAR_TIPE, META_TIPE } from '../slide/metaTipe.js';

const emit = defineEmits<{ pilih: [tipe: TipeSlide]; tutup: [] }>();
</script>

<template>
  <div class="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 px-4" @click.self="emit('tutup')">
    <div class="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
      <h3 class="font-semibold text-slate-800 mb-4">Pilih tipe slide</h3>

      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="tipe in DAFTAR_TIPE"
          :key="tipe"
          type="button"
          class="flex items-start gap-2 text-left rounded-xl border border-slate-200 p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
          @click="emit('pilih', tipe)"
        >
          <span class="text-xl">{{ META_TIPE[tipe].ikon }}</span>
          <span>
            <span class="block text-sm font-medium text-slate-700">{{ META_TIPE[tipe].label }}</span>
            <span class="block text-xs text-slate-400">{{ META_TIPE[tipe].keluarga === 'kahoot' ? 'Berpoin' : 'Jajak pendapat' }}</span>
          </span>
        </button>
      </div>

      <button type="button" class="mt-4 text-sm text-slate-400 hover:text-slate-600" @click="emit('tutup')">Batal</button>
    </div>
  </div>
</template>

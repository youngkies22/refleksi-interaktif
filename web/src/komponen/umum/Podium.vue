<script setup lang="ts">
import type { BarisPeringkat } from '@bersama/tipe';
import { computed } from 'vue';

const props = defineProps<{ top: BarisPeringkat[] }>();

const p1 = computed(() => props.top[0]);
const p2 = computed(() => props.top[1]);
const p3 = computed(() => props.top[2]);
</script>

<template>
  <div class="flex items-end justify-center gap-2 sm:gap-4 py-8 px-2">
    <div v-if="p2" class="text-center w-20 sm:w-24 shrink-0">
      <p class="font-semibold mb-2 truncate">{{ p2.nama }}</p>
      <div class="w-20 h-24 sm:w-24 sm:h-24 bg-slate-300 rounded-t-lg flex items-center justify-center text-3xl font-bold text-slate-700">2</div>
      <p class="text-sm text-slate-400 mt-1">{{ p2.skor }} poin</p>
    </div>
    <div v-if="p1" class="text-center w-24 sm:w-28 shrink-0">
      <p class="font-bold mb-2 text-lg truncate">🏆 {{ p1.nama }}</p>
      <div class="w-24 h-32 sm:w-28 sm:h-32 bg-amber-300 rounded-t-lg flex items-center justify-center text-4xl font-bold text-amber-800">1</div>
      <p class="text-sm text-slate-400 mt-1">{{ p1.skor }} poin</p>
    </div>
    <div v-if="p3" class="text-center w-20 sm:w-24 shrink-0">
      <p class="font-semibold mb-2 truncate">{{ p3.nama }}</p>
      <div class="w-20 h-16 sm:w-24 sm:h-16 bg-orange-300 rounded-t-lg flex items-center justify-center text-3xl font-bold text-orange-800">3</div>
      <p class="text-sm text-slate-400 mt-1">{{ p3.skor }} poin</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BarisPeringkat } from '@bersama/tipe';

defineProps<{ top: BarisPeringkat[] }>();
</script>

<template>
  <div class="space-y-2">
    <!-- TransitionGroup memberi animasi FLIP gratis saat peringkat saling
         menyalip antar soal — tanpa ini harus dihitung manual posisi lama/baru. -->
    <TransitionGroup tag="div" name="baris" class="space-y-2">
      <div
        v-for="b in top"
        :key="b.id"
        class="flex items-center gap-3 rounded-xl bg-white/10 py-2.5 px-4"
      >
        <span class="w-8 text-lg font-bold text-amber-300 shrink-0">#{{ b.peringkat }}</span>
        <span class="flex-1 min-w-0 truncate font-medium">{{ b.nama }}</span>
        <span class="font-mono font-bold shrink-0">{{ b.skor }}</span>
      </div>
    </TransitionGroup>
    <p v-if="top.length === 0" class="text-center text-slate-400 text-sm">Belum ada skor.</p>
  </div>
</template>

<style scoped>
.baris-move {
  transition: transform 0.4s ease;
}
</style>

<script setup lang="ts">
/**
 * Tombol/tautan "kembali" bergaya seragam di seluruh halaman — ikon panah
 * SVG di dalam target klik bulat, BUKAN karakter teks "←" polos (yang
 * area kliknya kecil & tidak konsisten terlihat sebagai tombol).
 *
 * Beri prop `to` untuk navigasi deklaratif (render `RouterLink`), atau
 * biarkan kosong dan dengarkan event `click` untuk navigasi terprogram
 * (mis. lewat `router.push` di dalam fungsi lain).
 */
defineProps<{ to?: string; title?: string }>();
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <RouterLink
    v-if="to"
    :to="to"
    :title="title"
    class="inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors"
  >
    <svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
      <path
        fill-rule="evenodd"
        d="M9.707 14.707a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 0-1.414l4-4a1 1 0 1 1 1.414 1.414L7.414 9H16a1 1 0 1 1 0 2H7.414l2.293 2.293a1 1 0 0 1 0 1.414z"
        clip-rule="evenodd"
      />
    </svg>
  </RouterLink>
  <button
    v-else
    type="button"
    :title="title"
    class="inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors"
    @click="emit('click')"
  >
    <svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
      <path
        fill-rule="evenodd"
        d="M9.707 14.707a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 0-1.414l4-4a1 1 0 1 1 1.414 1.414L7.414 9H16a1 1 0 1 1 0 2H7.414l2.293 2.293a1 1 0 0 1 0 1.414z"
        clip-rule="evenodd"
      />
    </svg>
  </button>
</template>

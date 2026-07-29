<script setup lang="ts">
/**
 * Guru men-drag kotak di atas gambar untuk menandai area jawaban benar.
 * Koordinat disimpan RELATIF (0..1 terhadap lebar/tinggi gambar) — bukan
 * piksel — supaya titik jatuh di tempat yang sama persis baik di layar
 * proyektor 1080p maupun di HP 360px.
 */
import type { AreaBenar } from '@bersama/tipe';
import { ref } from 'vue';

const props = defineProps<{ gambarPath: string; area: AreaBenar | undefined }>();
const emit = defineEmits<{ ubah: [area: AreaBenar] }>();

const kontainer = ref<HTMLElement | null>(null);
const menggambar = ref(false);
const mulaiX = ref(0);
const mulaiY = ref(0);
const kotakSementara = ref<AreaBenar | null>(null);

function relatif(e: PointerEvent): { x: number; y: number } {
  const rect = kontainer.value!.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}

function mulai(e: PointerEvent): void {
  const { x, y } = relatif(e);
  mulaiX.value = x;
  mulaiY.value = y;
  menggambar.value = true;
  kotakSementara.value = { bentuk: 'kotak', x, y, w: 0, h: 0 };
}

function gerak(e: PointerEvent): void {
  if (!menggambar.value) return;
  const { x, y } = relatif(e);
  kotakSementara.value = {
    bentuk: 'kotak',
    x: Math.min(mulaiX.value, x),
    y: Math.min(mulaiY.value, y),
    w: Math.abs(x - mulaiX.value),
    h: Math.abs(y - mulaiY.value),
  };
}

function selesai(): void {
  if (!menggambar.value || !kotakSementara.value) return;
  menggambar.value = false;
  if (kotakSementara.value.w > 0.01 && kotakSementara.value.h > 0.01) {
    emit('ubah', kotakSementara.value);
  }
}

const areaTampil = () => kotakSementara.value ?? props.area ?? null;
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs text-slate-400">Seret di atas gambar untuk menandai area jawaban benar</p>
    <div
      ref="kontainer"
      class="relative inline-block select-none touch-none cursor-crosshair max-w-full"
      @pointerdown="mulai"
      @pointermove="gerak"
      @pointerup="selesai"
    >
      <img :src="gambarPath" class="max-w-full block rounded-lg" draggable="false" />
      <div
        v-if="areaTampil()"
        class="absolute border-2 border-emerald-400 bg-emerald-400/20"
        :style="{
          left: areaTampil()!.x * 100 + '%',
          top: areaTampil()!.y * 100 + '%',
          width: areaTampil()!.w * 100 + '%',
          height: areaTampil()!.h * 100 + '%',
        }"
      />
    </div>
  </div>
</template>

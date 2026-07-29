<script setup lang="ts">
import type { AgregatTeks, JawabanPayload, Slide } from '@bersama/tipe';
import { BATAS } from '@bersama/konstanta';
import { ref } from 'vue';

defineProps<{
  slide: Slide;
  agregat: AgregatTeks | null;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
}>();
const emit = defineEmits<{
  jawab: [payload: JawabanPayload];
  sembunyikan: [jawabanId: number];
}>();

const teks = ref('');

// Beberapa palet sticky-note pastel, dipilih dari hash id kartu — semata
// variasi visual (tidak mengkodekan data apa pun), supaya dinding kartu
// terasa hidup seperti Padlet/Menti, bukan kartu kuning yang berulang.
const PALET = [
  'bg-amber-50 border-amber-200',
  'bg-sky-50 border-sky-200',
  'bg-emerald-50 border-emerald-200',
  'bg-rose-50 border-rose-200',
  'bg-violet-50 border-violet-200',
];
function paletKartu(id: number): string {
  return PALET[id % PALET.length]!;
}
function rotasiKartu(id: number): number {
  return ((id * 7) % 5) - 2; // -2..2 derajat
}

function kirim(): void {
  if (teks.value.trim() === '') return;
  emit('jawab', { tipe: 'open_ended', teks: teks.value });
  teks.value = '';
}
</script>

<template>
  <div class="space-y-4">
    <form v-if="mode === 'peserta' && !sudahJawab && !terkunci" class="space-y-3" @submit.prevent="kirim">
      <textarea
        v-model="teks"
        rows="3"
        :maxlength="BATAS.openEnded"
        placeholder="Tulis jawabanmu..."
        class="w-full rounded-xl border border-slate-300 py-3 px-4 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <p class="text-xs text-slate-400 text-right">{{ teks.length }}/{{ BATAS.openEnded }}</p>
      <button type="submit" class="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 hover:bg-blue-700 active:scale-[0.99] transition-transform">
        Kirim
      </button>
    </form>
    <p v-else-if="mode === 'peserta'" class="text-center text-slate-400">✓ Jawaban terkirim. Menunggu peserta lain...</p>

    <div v-if="mode === 'presenter' && !terkunci" class="text-center py-10">
      <p class="text-slate-400">⏳ Menunggu dikunci untuk menampilkan hasil...</p>
      <p class="text-sm text-slate-400 mt-2">{{ agregat?.total ?? 0 }} jawaban masuk</p>
    </div>
    <div v-else-if="agregat && (mode === 'presenter' || sudahJawab)">
      <p v-if="agregat.data.length === 0" class="text-slate-400 text-center py-10">Belum ada jawaban.</p>
      <TransitionGroup
        v-else
        tag="div"
        name="kartu-masuk"
        class="[column-width:15rem] [column-gap:0.75rem]"
      >
        <div
          v-for="d in agregat.data"
          :key="d.id"
          class="group relative break-inside-avoid mb-3 border rounded-xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
          :class="paletKartu(d.id)"
          :style="{ transform: `rotate(${rotasiKartu(d.id)}deg)` }"
        >
          <button
            v-if="mode === 'presenter'"
            type="button"
            title="Sembunyikan jawaban ini dari layar"
            class="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/80 text-slate-400 hover:bg-red-500 hover:text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-all"
            @click="emit('sembunyikan', d.id)"
          >
            ✕
          </button>
          <p class="text-slate-700 text-sm whitespace-pre-wrap">{{ d.teks }}</p>
          <p v-if="d.nama" class="text-xs text-slate-500 mt-2 font-medium">— {{ d.nama }}</p>
        </div>
      </TransitionGroup>
      <p v-if="agregat.data.length > 0" class="text-center text-xs text-slate-400 mt-1">{{ agregat.total }} jawaban</p>
    </div>
  </div>
</template>

<style scoped>
/* Hanya opacity yang dianimasikan di sini — `transform` kartu sudah dipakai
   permanen untuk rotasi sticky-note lewat :style inline, dan inline style
   selalu menang atas class CSS untuk properti yang sama. Kalau enter-from di
   bawah ikut men-set `transform`, animasinya akan tertimpa diam-diam dan tidak
   pernah kelihatan — makanya transform TIDAK disentuh di sini sama sekali. */
.kartu-masuk-enter-active {
  transition: opacity 0.4s ease;
}
.kartu-masuk-enter-from {
  opacity: 0;
}
.kartu-masuk-move {
  transition: transform 0.4s ease;
}
</style>

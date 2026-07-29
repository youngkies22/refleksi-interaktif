<script setup lang="ts">
import type { AgregatKata, JawabanPayload, Slide } from '@bersama/tipe';
import { BATAS } from '@bersama/konstanta';
import { computed, ref } from 'vue';

const props = defineProps<{
  slide: Slide;
  agregat: AgregatKata | null;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
}>();
const emit = defineEmits<{ jawab: [payload: JawabanPayload] }>();

const teks = ref('');
const maksJumlah = computed(() => Math.max(1, ...(props.agregat?.data.map((d) => d.jumlah) ?? [1])));

/**
 * Setiap kata dapat warna & sedikit rotasi dari HASH kata itu sendiri — bukan
 * dari posisi/urutan (yang berubah tiap kata lain naik-turun frekuensi).
 * Warna di sini tidak mengkodekan data apa pun (frekuensi sudah lewat ukuran),
 * jadi variasi warna murni untuk kesan "awan kata" yang hidup, bukan salah
 * satu channel yang perlu konsisten secara semantik seperti pada bar chart.
 */
const WARNA_KATA = ['text-blue-600', 'text-violet-600', 'text-emerald-600', 'text-orange-600', 'text-rose-600', 'text-cyan-700'];

function hashKata(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function warnaKata(kata: string): string {
  return WARNA_KATA[hashKata(kata) % WARNA_KATA.length]!;
}

function rotasiKata(kata: string): number {
  return (hashKata(kata) % 7) - 3; // -3..3 derajat, cukup halus agar tetap mudah dibaca
}

function ukuranFont(jumlah: number): string {
  // ukuran ∝ sqrt(jumlah) — kata yang 4x lebih sering hanya 2x lebih besar,
  // supaya satu kata populer tidak menenggelamkan seluruh tampilan.
  // clamp() menahan ukuran maksimum di layar kecil (HP) agar tidak overflow.
  const skala = Math.sqrt(jumlah / maksJumlah.value);
  const rem = 1 + skala * 2.25;
  return `clamp(1rem, ${rem}rem, ${rem}rem)`;
}

function kirim(): void {
  if (teks.value.trim() === '') return;
  emit('jawab', { tipe: 'wordcloud', teks: teks.value });
  teks.value = '';
}
</script>

<template>
  <div class="space-y-6">
    <form v-if="mode === 'peserta' && !sudahJawab && !terkunci" class="space-y-3" @submit.prevent="kirim">
      <input
        v-model="teks"
        type="text"
        :maxlength="BATAS.kata * (slide.konfig.maks_kata ?? 3)"
        :placeholder="`Tulis ${slide.konfig.maks_kata ?? 3} kata, pisahkan spasi`"
        class="w-full rounded-xl border border-slate-300 py-3 px-4 text-center text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
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
      <p v-if="agregat.data.length === 0" class="text-center text-slate-400 py-10">Belum ada jawaban.</p>
      <div v-else class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-6 px-2">
        <span
          v-for="d in agregat.data"
          :key="d.kata"
          :title="`${d.kata} — ${d.jumlah}×`"
          class="font-bold leading-tight transition-all duration-500 hover:scale-110 hover:!rotate-0 cursor-default"
          :class="warnaKata(d.kata)"
          :style="{ fontSize: ukuranFont(d.jumlah), transform: `rotate(${rotasiKata(d.kata)}deg)` }"
        >
          {{ d.kata }}
        </span>
      </div>
      <p v-if="agregat.data.length > 0" class="text-center text-xs text-slate-400">{{ agregat.total }} kata terkirim</p>
    </div>
  </div>
</template>

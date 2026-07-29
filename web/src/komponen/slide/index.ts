import type { TipeMenti } from '@bersama/tipe';
import type { Component } from 'vue';
import KetikJawaban from './KetikJawaban.vue';
import Kuis from './Kuis.vue';
import OpenEnded from './OpenEnded.vue';
import PilihanGanda from './PilihanGanda.vue';
import Peringkat from './Peringkat.vue';
import PinJawaban from './PinJawaban.vue';
import Puzzle from './Puzzle.vue';
import Skala from './Skala.vue';
import WordCloud from './WordCloud.vue';

/**
 * Satu-satunya tempat tipe slide Menti dipetakan ke komponennya.
 * Menambah tipe ke-6 (keluarga Menti) cukup menambah satu baris di sini —
 * bukan rantai if/else di halaman presenter/peserta.
 */
export const KOMPONEN_MENTI: Record<TipeMenti, Component> = {
  wordcloud: WordCloud,
  pilihan_ganda: PilihanGanda,
  open_ended: OpenEnded,
  skala: Skala,
  peringkat: Peringkat,
};

/**
 * `kuis` dan `benar_salah` berbagi SATU komponen (Kuis.vue) — bentuknya sama,
 * bedanya cuma tata letak tombol berdasarkan jumlah opsi. `ketik_jawaban`,
 * `puzzle`, `pin_jawaban` masing-masing komponen sendiri karena bentuk
 * inputnya benar-benar berbeda (ketik teks / seret urutan / tap di gambar).
 */
export const KOMPONEN_KAHOOT_AKTIF: Partial<Record<string, Component>> = {
  kuis: Kuis,
  benar_salah: Kuis,
  ketik_jawaban: KetikJawaban,
  puzzle: Puzzle,
  pin_jawaban: PinJawaban,
};

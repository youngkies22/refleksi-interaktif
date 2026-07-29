import { randomInt } from 'node:crypto';
import { ALFABET_KODE, PANJANG_KODE } from '../../shared/konstanta.js';

/**
 * Buat kode gabung 6 karakter dari alfabet tanpa karakter ambigu.
 * `randomInt` dari node:crypto (bukan Math.random) — kode ini dipakai sebagai
 * gerbang masuk sesi/papan, jadi harus tidak bisa ditebak berurutan.
 */
export function buatKode(): string {
  let hasil = '';
  for (let i = 0; i < PANJANG_KODE; i++) {
    hasil += ALFABET_KODE[randomInt(ALFABET_KODE.length)];
  }
  return hasil;
}

/** Normalisasi input kode dari peserta: buang spasi & karakter non-digit. */
export function normalisasiKode(input: string): string {
  return input.trim().replace(/\D+/g, '');
}

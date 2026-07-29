import { KODE_GALAT, type KodeGalat } from '../shared/konstanta.js';
import type { GalatKirim } from '../shared/tipe.js';

/**
 * Galat yang memang diniatkan — aman ditampilkan ke pengguna.
 *
 * Bedakan tegas dari galat tak terduga: yang ini pesannya boleh dikirim apa adanya,
 * sedangkan galat tak terduga selalu diganti pesan generik supaya detail internal
 * (jalur berkas, potongan SQL) tidak bocor ke peserta.
 */
export class GalatAplikasi extends Error {
  readonly kode: KodeGalat;
  readonly status: number;

  constructor(kode: KodeGalat, pesan: string, status: number) {
    super(pesan);
    this.name = 'GalatAplikasi';
    this.kode = kode;
    this.status = status;
    Error.captureStackTrace?.(this, GalatAplikasi);
  }

  keKirim(): GalatKirim {
    return { kode: this.kode, pesan: this.message };
  }
}

export const galatValidasi = (pesan: string): GalatAplikasi =>
  new GalatAplikasi(KODE_GALAT.VALIDASI, pesan, 400);

export const galatTidakDiizinkan = (pesan = 'Anda tidak punya akses ke sini.'): GalatAplikasi =>
  new GalatAplikasi(KODE_GALAT.TIDAK_DIIZINKAN, pesan, 401);

export const galatTidakDitemukan = (pesan = 'Data tidak ditemukan.'): GalatAplikasi =>
  new GalatAplikasi(KODE_GALAT.TIDAK_DITEMUKAN, pesan, 404);

export const galatTerlaluCepat = (pesan = 'Terlalu banyak kiriman. Coba lagi sebentar.'): GalatAplikasi =>
  new GalatAplikasi(KODE_GALAT.TERLALU_CEPAT, pesan, 429);

export const galatSudahMenjawab = (pesan = 'Anda sudah menjawab pertanyaan ini.'): GalatAplikasi =>
  new GalatAplikasi(KODE_GALAT.SUDAH_MENJAWAB, pesan, 409);

export const galatSesiDitutup = (pesan = 'Pertanyaan ini sudah ditutup.'): GalatAplikasi =>
  new GalatAplikasi(KODE_GALAT.SESI_DITUTUP, pesan, 409);

/** Ubah galat apa pun jadi bentuk yang aman dikirim ke klien. */
export function keGalatKirim(e: unknown): GalatKirim {
  if (e instanceof GalatAplikasi) return e.keKirim();
  return {
    kode: KODE_GALAT.GALAT_SERVER,
    pesan: 'Terjadi kesalahan di server. Silakan coba lagi.',
  };
}

export function statusDariGalat(e: unknown): number {
  return e instanceof GalatAplikasi ? e.status : 500;
}

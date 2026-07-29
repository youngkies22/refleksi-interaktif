const PREFIKS = 'refleksi_token_';

/**
 * Token peserta disimpan per-KODE, bukan global — satu HP boleh ikut banyak
 * sesi berbeda, dan tiap sesi punya identitas token sendiri (lihat skema
 * `peserta`: UNIQUE(sesi_id, token)). Rejoin ke kode yang sama mengembalikan
 * token lama sehingga skor & riwayat jawaban tetap dikenali server.
 */
export function ambilTokenTersimpan(kode: string): string | undefined {
  return localStorage.getItem(PREFIKS + kode.toUpperCase()) ?? undefined;
}

export function simpanToken(kode: string, token: string): void {
  localStorage.setItem(PREFIKS + kode.toUpperCase(), token);
}

/** Dipanggil saat sesi/papan selesai — token lama untuk kode itu sudah tidak
 *  berguna, jangan ditinggalkan menumpuk di localStorage HP peserta. */
export function hapusTokenTersimpan(kode: string): void {
  localStorage.removeItem(PREFIKS + kode.toUpperCase());
}

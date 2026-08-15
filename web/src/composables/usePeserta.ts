const PREFIKS = 'refleksi_token_';
const PREFIKS_NAMA = 'refleksi_nama_';

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
  localStorage.removeItem(PREFIKS_NAMA + kode.toUpperCase());
}

/**
 * Nama dipakai KHUSUS untuk papan — beda dari sesi live kuis, papan TIDAK
 * punya tabel `peserta` di database, jadi server tidak bisa "mengingat"
 * nama dari join pertama; ia murni disimpan di memori socket (`papanNama`)
 * yang HILANG tiap kali socket baru dibuat (reload halaman/tab baru). Kalau
 * nama tidak ikut disimpan & dikirim ulang bersama token pada auto-rejoin,
 * peserta yang tadinya sudah isi nama jadi "Anonim" lagi setiap refresh.
 */
export function ambilNamaTersimpan(kode: string): string | undefined {
  return localStorage.getItem(PREFIKS_NAMA + kode.toUpperCase()) ?? undefined;
}

export function simpanNama(kode: string, nama: string): void {
  localStorage.setItem(PREFIKS_NAMA + kode.toUpperCase(), nama);
}

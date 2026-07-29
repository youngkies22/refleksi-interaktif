/**
 * Konstanta bersama — server dan Vue memakai angka yang sama persis.
 *
 * Kalau batas panjang ditulis dua kali (sekali di validasi server, sekali di
 * `maxlength` input Vue), cepat atau lambat keduanya berbeda dan peserta melihat
 * "jawaban terkirim" padahal server menolaknya. Karena itu satu tempat saja.
 */

/* ────────────────────────── Kode gabung ────────────────────────── */

/**
 * Tanpa 0, O, 1, I, L — karakter yang paling sering salah dibaca dari proyektor
 * di baris belakang. 31 karakter × 6 posisi ≈ 887 juta kombinasi.
 */
/** Angka saja — lebih mudah dibacakan lisan di depan kelas & diketik di HP
 *  (keypad numerik) dibanding kombinasi huruf-angka. */
export const ALFABET_KODE = '0123456789';
export const PANJANG_KODE = 6;

/* ────────────────────────── Batas panjang ────────────────────────── */

export const BATAS = {
  nama: 40,
  kata: 30,
  openEnded: 280,
  ketikJawaban: 120,
  kartuJudul: 120,
  kartuIsi: 500,
  komentar: 200,
  pertanyaan: 300,
  opsiTeks: 120,
  judulPresentasi: 150,
  namaAplikasi: 60,
} as const;

/* ──────────────────────────── Anti spam ──────────────────────────── */

export const ANTISPAM = {
  /** jawaban per jendela, per token peserta */
  jawabanMaks: 5,
  jawabanJendelaDetik: 10,
  /** kartu papan per menit, per token */
  kartuMaks: 10,
  kartuJendelaDetik: 60,
} as const;

/** Kunci akun & IP dilepas terpisah supaya satu penyerang yang menembak banyak
 *  username dari satu IP tetap kena batas IP, sementara login gagal dari IP
 *  lain untuk akun yang sama tidak ikut memperpanjang kuncian akun itu. */
export const RATE_LOGIN = {
  maksPerAkun: 5,
  jendelaAkunDetik: 300,
  maksPerIp: 20,
  jendelaIpDetik: 300,
} as const;

/* ───────────────────────────── Realtime ───────────────────────────── */

/**
 * Agregat disiarkan paling sering tiap 250 ms (4×/detik), bukan tiap jawaban masuk.
 * 500 siswa submit serempak: 500 broadcast × 500 socket = 250.000 pesan menjadi 4 pesan.
 * Ini optimasi tunggal dengan dampak terbesar di seluruh aplikasi.
 */
export const JEDA_SIARAN_MS = 250;

/** Batas buffer sebelum flush paksa ke SQLite. */
export const BATCH_JAWABAN_MAKS = 200;
export const BATCH_JEDA_MS = 500;

/** Umur key Redis. Diperpanjang tiap ada aktivitas di sesi. */
export const TTL_SESI_DETIK = 6 * 60 * 60;

/* ─────────────────────────── Skor Kahoot ─────────────────────────── */

export const POIN_MAKS = 1000;
export const BATAS_DETIK_BAWAAN = 20;

/**
 * Poin = ketepatan × maks × (1 − rasioWaktu × 0.5)
 *
 * Jawaban benar di detik pertama ≈ 1000 poin, di detik terakhir ≈ 500 poin.
 * Setengah nilai tetap diberikan agar siswa yang berpikir lambat tapi benar tidak
 * merasa sia-sia — ini keputusan pedagogis, bukan teknis.
 *
 * `waktuMs` WAJIB dihitung di server dari `mulaiSlideAt`. Kalau diambil dari
 * timestamp klien, siswa bisa memalsukan kecepatan jawabnya.
 */
export function hitungPoin(ketepatan: number, waktuMs: number, batasMs: number): number {
  if (ketepatan <= 0) return 0;
  const rasio = batasMs > 0 ? Math.min(Math.max(waktuMs / batasMs, 0), 1) : 1;
  return Math.round(POIN_MAKS * ketepatan * (1 - rasio * 0.5));
}

/* ─────────────────────────── Unggahan ─────────────────────────── */

export const UNGGAH = {
  maksByte: 5 * 1024 * 1024,
  mimeDiizinkan: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
} as const;

/** Import massal akun guru lewat berkas CSV — lihat layanan/auth.ts. */
export const IMPOR_GURU = {
  maksByte: 2 * 1024 * 1024,
} as const;

/**
 * Backup/restore seluruh presentasi & papan (semua guru) dalam satu berkas
 * JSON — lihat layanan/backup.ts. Batasnya jauh lebih besar dari IMPOR_GURU
 * karena gambar lampiran (pin_jawaban, kartu papan) ikut ter-embed base64.
 */
export const BACKUP_KONTEN = {
  maksByte: 50 * 1024 * 1024,
} as const;

/* ─────────────────────── Kode galat yang dipakai ─────────────────────── */

export const KODE_GALAT = {
  TIDAK_DIIZINKAN: 'TIDAK_DIIZINKAN',
  TIDAK_DITEMUKAN: 'TIDAK_DITEMUKAN',
  VALIDASI: 'VALIDASI',
  SUDAH_MENJAWAB: 'SUDAH_MENJAWAB',
  SESI_DITUTUP: 'SESI_DITUTUP',
  TERLALU_CEPAT: 'TERLALU_CEPAT',
  GALAT_SERVER: 'GALAT_SERVER',
} as const;

export type KodeGalat = (typeof KODE_GALAT)[keyof typeof KODE_GALAT];

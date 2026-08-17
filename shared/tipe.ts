/**
 * Tipe bersama — diimpor oleh server (src/) DAN frontend Vue (web/).
 *
 * File ini adalah satu-satunya sumber kebenaran bentuk data yang melintasi jaringan.
 * Jangan menyalin definisi dari sini ke tempat lain: begitu ada dua salinan, keduanya
 * akan menyimpang diam-diam dan compiler tidak bisa menolong lagi.
 */

/* ─────────────────────────── Tipe slide ─────────────────────────── */

/** Slide jajak pendapat ala Mentimeter — tidak ada jawaban benar, tidak ada poin. */
export const TIPE_MENTI = [
  'wordcloud',
  'pilihan_ganda',
  'open_ended',
  'skala',
  'peringkat',
] as const;

/** Slide berpoin ala Kahoot — punya jawaban benar, timer, dan masuk leaderboard. */
export const TIPE_KAHOOT = [
  'kuis',
  'benar_salah',
  'ketik_jawaban',
  'puzzle',
  'pin_jawaban',
] as const;

export type TipeMenti = (typeof TIPE_MENTI)[number];
export type TipeKahoot = (typeof TIPE_KAHOOT)[number];
export type TipeSlide = TipeMenti | TipeKahoot;

export const SEMUA_TIPE_SLIDE: readonly TipeSlide[] = [...TIPE_MENTI, ...TIPE_KAHOOT];

/** Apakah slide ini berpoin & bertimer? Dipakai server dan Vue, jadi ditaruh di sini. */
export function slideBerpoin(tipe: TipeSlide): tipe is TipeKahoot {
  return (TIPE_KAHOOT as readonly string[]).includes(tipe);
}

/* ─────────────────────── Konfigurasi per slide ─────────────────────── */

export type BentukArea = 'kotak' | 'lingkaran';

/** Koordinat relatif 0..1 terhadap lebar/tinggi gambar — BUKAN piksel.
 *  Ini yang membuat titik jatuh di tempat sama di proyektor 1080p maupun HP 360px. */
export interface AreaBenar {
  bentuk: BentukArea;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KonfigSlide {
  /** Semua tipe. Kalau true, peserta ikut melihat agregat di HP-nya. */
  tampilkan_hasil_ke_peserta?: boolean;

  /** Keluarga Kahoot. */
  batas_detik?: number;
  poin_aktif?: boolean;

  /** wordcloud */
  maks_kata?: number;

  /** skala */
  min?: number;
  maks?: number;
  label_min?: string;
  label_maks?: string;

  /** ketik_jawaban */
  jawaban_diterima?: string[];
  cocok_persis?: boolean;

  /** puzzle — urutan benar diambil dari kolom `opsi.urutan` */
  poin_parsial?: boolean;

  /** pin_jawaban */
  gambar_path?: string;
  area_benar?: AreaBenar;
}

export interface Opsi {
  id: number;
  urutan: number;
  teks: string;
  /** Sengaja tidak dikirim ke peserta sebelum timer habis — lihat catatan di kontrak.ts. */
  benar?: boolean;
}

export interface Slide {
  id: number;
  urutan: number;
  tipe: TipeSlide;
  pertanyaan: string;
  konfig: KonfigSlide;
  opsi: Opsi[];
}

export interface RingkasPresentasi {
  id: number;
  judul: string;
  deskripsi: string;
  jumlahSlide: number;
  updatedAt: string;
}

export interface DetailPresentasi {
  id: number;
  judul: string;
  deskripsi: string;
  slide: Slide[];
}

/** Ringkasan presentasi + info pemiliknya — dipakai superadmin untuk melihat
 *  seluruh presentasi lintas guru dalam satu daftar. */
export interface RingkasPresentasiAdmin extends RingkasPresentasi {
  guruId: number;
  guruNama: string;
  guruUsername: string;
}

/* ───────────────────────── Payload jawaban ───────────────────────── */

/**
 * Discriminated union — inti alasan project ini pakai TypeScript.
 * Menambah tipe slide baru di sini akan membuat compiler menunjuk setiap
 * switch/handler yang belum menanganinya.
 */
export type JawabanPayload =
  | { tipe: 'pilihan_ganda' | 'kuis' | 'benar_salah'; opsiId: number }
  | { tipe: 'wordcloud' | 'open_ended' | 'ketik_jawaban'; teks: string }
  | { tipe: 'skala'; nilai: number }
  | { tipe: 'peringkat' | 'puzzle'; urutan: number[] }
  | { tipe: 'pin_jawaban'; x: number; y: number };

/* ────────────────────────── Bentuk agregat ────────────────────────── */

export interface AgregatHitung {
  bentuk: 'hitung';
  /** kunci = opsiId (sebagai string) atau nilai skala */
  data: Record<string, number>;
  total: number;
}

export interface AgregatKata {
  bentuk: 'kata';
  data: { kata: string; jumlah: number }[];
  total: number;
}

export interface AgregatTeks {
  bentuk: 'teks';
  data: { id: number; nama: string | null; teks: string; ts: number }[];
  total: number;
}

export interface AgregatPosisi {
  bentuk: 'posisi';
  /** rata-rata posisi tiap opsi (1 = paling atas) */
  data: { opsiId: number; rataPosisi: number }[];
  total: number;
}

export interface AgregatTitik {
  bentuk: 'titik';
  data: { x: number; y: number; benar: boolean }[];
  total: number;
}

export type AgregatSlide =
  | AgregatHitung
  | AgregatKata
  | AgregatTeks
  | AgregatPosisi
  | AgregatTitik;

/* ───────────────────────────── Sesi ───────────────────────────── */

export type StatusSesi = 'menunggu' | 'berjalan' | 'selesai';

export interface RingkasanPeserta {
  id: number;
  nama: string;
  skor: number;
}

export interface BarisPeringkat extends RingkasanPeserta {
  peringkat: number;
}

/** Kondisi sesi yang dikirim ke peserta. Sengaja minim — jangan bocorkan jawaban benar. */
export interface KondisiSesi {
  sesiId: number;
  kode: string;
  status: StatusSesi;
  slide: Slide | null;
  /** true = masih menerima jawaban */
  dibuka: boolean;
  /** epoch ms saat slide dibuka; dipakai klien hanya untuk menggambar timer */
  mulaiSlideAt: number | null;
  sudahJawab: boolean;
  jumlahSlide: number;
}

/* ───────────────────────── Papan kolaboratif ───────────────────────── */

export type TataLetakPapan = 'kolom' | 'dinding';

export interface Kolom {
  id: number;
  urutan: number;
  judul: string;
  warna: string;
}

export interface Kartu {
  id: number;
  kolomId: number | null;
  penulisNama: string | null;
  judul: string;
  isi: string;
  warna: string;
  lampiranPath: string | null;
  urutan: number;
  disetujui: boolean;
  jumlahLike: number;
  jumlahKomentar: number;
  /** true kalau kartu ini milik pembaca saat ini (boleh diedit/dihapus) */
  milikSaya: boolean;
  createdAt: string;
}

export interface Papan {
  id: number;
  kode: string;
  judul: string;
  deskripsi: string;
  tataLetak: TataLetakPapan;
  anonim: boolean;
  perluPersetujuan: boolean;
  izinkanLike: boolean;
  izinkanKomentar: boolean;
  terkunci: boolean;
}

export interface RingkasPapan {
  id: number;
  kode: string;
  judul: string;
  jumlahKartu: number;
  jumlahMenunggu: number;
  updatedAt: string;
}

/** Ringkasan papan + info pemiliknya — dipakai superadmin untuk melihat
 *  seluruh papan lintas guru dalam satu daftar. */
export interface RingkasPapanAdmin extends RingkasPapan {
  guruId: number;
  guruNama: string;
  guruUsername: string;
}

export interface Komentar {
  id: number;
  nama: string | null;
  isi: string;
  createdAt: string;
}

/* ───────────────────────────── Umum ───────────────────────────── */

export interface Guru {
  id: number;
  username: string;
  nama: string;
  role: 'admin' | 'guru';
}

/** Bentuk `Guru` dengan field tambahan yang hanya relevan untuk superadmin. */
export interface GuruAdmin extends Guru {
  aktif: boolean;
}

/** Satu baris audit trail tindakan superadmin. */
export interface LogAdminEntri {
  id: number;
  adminNama: string;
  aksi: string;
  targetTipe: string;
  targetId: number | null;
  detail: string;
  createdAt: string;
}

/** Branding aplikasi — nama tab browser & logo header, diatur superadmin. */
export interface PengaturanAplikasi {
  namaAplikasi: string;
  logoUrl: string | null;
}

/** Konfigurasi object storage S3 — diatur superadmin lewat panel Kelola Guru.
 *  `secretKeyDiatur` cuma penanda ada/tidaknya; nilai secret-nya sendiri
 *  TIDAK PERNAH dikirim balik ke browser setelah tersimpan. */
export interface PengaturanS3Admin {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  /** Override URL publik — kosong = turunkan dari endpoint+bucket (cocok utk
   *  NevaObjects/MinIO/dll). WAJIB diisi untuk Cloudflare R2 (custom domain
   *  atau subdomain `*.r2.dev`) karena endpoint S3 R2 sendiri bersifat privat. */
  urlPublik: string;
  secretKeyDiatur: boolean;
  /** Pilihan admin — 's3' cuma bisa aktif kalau `lengkap` true (lihat `ubahModeS3`
   *  di `layanan/pengaturan.ts`). Terpisah dari isi field: mengetik/menyimpan
   *  kredensial TIDAK otomatis mengaktifkan S3, harus di-toggle eksplisit. */
  mode: 'lokal' | 's3';
  /** true kalau endpoint/bucket/accessKey/secretKey semuanya terisi — syarat
   *  supaya `mode` boleh dipindah ke 's3'. */
  lengkap: boolean;
  /** true kalau `mode === 's3'` DAN `lengkap` — gambar baru diunggah ke S3;
   *  false = disk lokal. */
  aktif: boolean;
}

/** Bentuk galat yang konsisten di seluruh API dan event socket. */
export interface GalatKirim {
  kode: string;
  pesan: string;
}

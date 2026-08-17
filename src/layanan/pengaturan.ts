import { getDb } from '../db/index.js';
import { galatValidasi } from '../galat.js';
import { BATAS } from '../../shared/konstanta.js';
import type { PengaturanAplikasi, PengaturanS3Admin } from '../../shared/tipe.js';

/**
 * Branding aplikasi (nama tab browser + logo header) — baris tunggal, diedit
 * superadmin lewat panel Kelola Guru. Dibaca PUBLIK (tanpa login) karena
 * halaman login & gabung sesi pun perlu menampilkannya.
 */

interface BarisPengaturan {
  nama_aplikasi: string;
  logo_path: string | null;
}

function keTipe(b: BarisPengaturan): PengaturanAplikasi {
  return { namaAplikasi: b.nama_aplikasi, logoUrl: b.logo_path };
}

export function ambilPengaturan(): PengaturanAplikasi {
  const b = getDb().prepare('SELECT nama_aplikasi, logo_path FROM pengaturan WHERE id = 1').get() as BarisPengaturan;
  return keTipe(b);
}

export function ubahNamaAplikasi(nama: string): PengaturanAplikasi {
  const n = nama.trim();
  if (n === '') throw galatValidasi('Nama aplikasi wajib diisi.');
  if (n.length > BATAS.namaAplikasi) {
    throw galatValidasi(`Nama aplikasi maksimal ${BATAS.namaAplikasi} karakter.`);
  }
  getDb().prepare(`UPDATE pengaturan SET nama_aplikasi = ?, updated_at = datetime('now') WHERE id = 1`).run(n);
  return ambilPengaturan();
}

/** `path` null = hapus logo (kembali ke lambang huruf bawaan di frontend). */
export function ubahLogo(path: string | null): PengaturanAplikasi {
  getDb().prepare(`UPDATE pengaturan SET logo_path = ?, updated_at = datetime('now') WHERE id = 1`).run(path);
  return ambilPengaturan();
}

/* ─────────────────── Object storage S3 (gambar unggahan) ─────────────────── */

/**
 * Konfigurasi S3 dipindah ke DB (bukan cuma `.env`) supaya admin bisa
 * mengubahnya lewat panel tanpa akses server/redeploy — lihat panel "Object
 * Storage" di halaman Kelola Guru. `.env` (S3_* di `config.ts`) hanya dipakai
 * SEKALI untuk seed awal saat baris ini masih kosong (lihat `db/seed.ts`),
 * sama seperti `ADMIN_USERNAME`/`ADMIN_PASSWORD` untuk akun admin pertama.
 */
interface BarisPengaturanS3 {
  s3_endpoint: string | null;
  s3_region: string;
  s3_bucket: string | null;
  s3_access_key: string | null;
  s3_secret_key: string | null;
  s3_url_publik: string | null;
  s3_mode: 'lokal' | 's3';
}

export interface KonfigS3 {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Override URL publik — WAJIB untuk Cloudflare R2, lihat `layanan/s3Klien.ts`. */
  urlPublik: string;
  /** Pilihan admin, lihat `ubahModeS3()` — TERPISAH dari `lengkap`. */
  mode: 'lokal' | 's3';
  /** endpoint/bucket/accessKey/secretKey semuanya terisi. */
  lengkap: boolean;
  /** `mode === 's3'` DAN `lengkap` — satu-satunya yang dibaca pemanggil di
   *  `layanan/unggah.ts` untuk memutuskan tujuan penyimpanan sesungguhnya. */
  aktif: boolean;
}

/** Termasuk secret key MENTAH — hanya untuk dipakai internal server (klien S3
 *  & unggahan). JANGAN PERNAH mengirim hasil fungsi ini langsung sebagai
 *  respons API; pakai `ambilKonfigS3Admin()` untuk itu. */
export function ambilKonfigS3(): KonfigS3 {
  const b = getDb()
    .prepare(
      'SELECT s3_endpoint, s3_region, s3_bucket, s3_access_key, s3_secret_key, s3_url_publik, s3_mode FROM pengaturan WHERE id = 1',
    )
    .get() as BarisPengaturanS3;

  const endpoint = b.s3_endpoint ?? '';
  const bucket = b.s3_bucket ?? '';
  const accessKey = b.s3_access_key ?? '';
  const secretKey = b.s3_secret_key ?? '';
  const lengkap = endpoint !== '' && bucket !== '' && accessKey !== '' && secretKey !== '';

  return {
    endpoint,
    region: b.s3_region || 'us-east-1',
    bucket,
    accessKey,
    secretKey,
    urlPublik: b.s3_url_publik ?? '',
    mode: b.s3_mode,
    lengkap,
    aktif: b.s3_mode === 's3' && lengkap,
  };
}

/** Bentuk AMAN untuk panel admin — `secretKeyDiatur` cuma penanda ada/tidaknya,
 *  nilai secret-nya sendiri tidak pernah ikut terkirim balik ke browser. */
export function ambilKonfigS3Admin(): PengaturanS3Admin {
  const k = ambilKonfigS3();
  return {
    endpoint: k.endpoint,
    region: k.region,
    bucket: k.bucket,
    accessKey: k.accessKey,
    urlPublik: k.urlPublik,
    secretKeyDiatur: k.secretKey !== '',
    mode: k.mode,
    lengkap: k.lengkap,
    aktif: k.aktif,
  };
}

export interface DataUbahS3 {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKey?: string;
  /** Kosong/tidak diisi = biarkan secret key lama — form tidak perlu
   *  menampilkan ulang secret hanya demi mengubah field lain (mis. bucket). */
  secretKey?: string;
  /** Beda dari field lain: field ini SELALU ditulis kalau ADA di body, walau
   *  isinya string kosong (= sengaja dikosongkan, kembali ke turunan
   *  endpoint+bucket) — cuma benar-benar `undefined` yang berarti "biarkan". */
  urlPublik?: string;
}

export function ubahKonfigS3(data: DataUbahS3): PengaturanS3Admin {
  const db = getDb();

  db.prepare(
    `UPDATE pengaturan SET
       s3_endpoint = COALESCE(?, s3_endpoint),
       s3_region = COALESCE(?, s3_region),
       s3_bucket = COALESCE(?, s3_bucket),
       s3_access_key = COALESCE(?, s3_access_key),
       s3_secret_key = COALESCE(?, s3_secret_key),
       updated_at = datetime('now')
     WHERE id = 1`,
  ).run(
    data.endpoint?.trim() || null,
    data.region?.trim() || null,
    data.bucket?.trim() || null,
    data.accessKey?.trim() || null,
    data.secretKey || null,
  );

  if (data.urlPublik !== undefined) {
    db.prepare(`UPDATE pengaturan SET s3_url_publik = ?, updated_at = datetime('now') WHERE id = 1`).run(
      data.urlPublik.trim() || null,
    );
  }

  return ambilKonfigS3Admin();
}

/** Kembali ke penyimpanan disk lokal — kosongkan seluruh kolom S3 (termasuk
 *  mode). Beda dari `ubahModeS3('lokal')`: ini MENGHAPUS kredensial, dipakai
 *  saat admin memang ingin melepas konfigurasi S3 sepenuhnya, bukan sekadar
 *  menonaktifkannya sementara. */
export function hapusKonfigS3(): PengaturanS3Admin {
  getDb()
    .prepare(
      `UPDATE pengaturan SET
         s3_endpoint = NULL, s3_bucket = NULL, s3_access_key = NULL, s3_secret_key = NULL, s3_url_publik = NULL,
         s3_mode = 'lokal', updated_at = datetime('now')
       WHERE id = 1`,
    )
    .run();
  return ambilKonfigS3Admin();
}

/**
 * Pindah mode penyimpanan aktif — TERPISAH dari isi field (lihat `KonfigS3.mode`
 * vs `.lengkap`). Menyimpan kredensial lewat `ubahKonfigS3()` tidak lagi
 * otomatis mengaktifkan S3; admin harus eksplisit pindah ke sini, dan bisa
 * balik ke lokal kapan saja tanpa kehilangan kredensial yang sudah tersimpan.
 *
 * Pindah ke `'s3'` ditolak kalau kredensial belum lengkap — mencegah mode
 * "aktif" tapi tidak benar-benar bisa dipakai (baca: `simpanGambarUnggahan`
 * akan diam-diam gagal connect kalau ini tidak dicegah di sini).
 */
export function ubahModeS3(mode: 'lokal' | 's3'): PengaturanS3Admin {
  if (mode === 's3' && !ambilKonfigS3().lengkap) {
    throw galatValidasi('Lengkapi dan simpan endpoint, bucket, access key, dan secret key dulu sebelum mengaktifkan S3.');
  }
  getDb().prepare(`UPDATE pengaturan SET s3_mode = ?, updated_at = datetime('now') WHERE id = 1`).run(mode);
  return ambilKonfigS3Admin();
}

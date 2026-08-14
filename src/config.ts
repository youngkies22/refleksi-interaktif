import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Konfigurasi aplikasi.
 *
 * Prinsip: `.env` itu OPSIONAL. Tanpa file konfigurasi apa pun, `docker compose up`
 * harus tetap menghasilkan aplikasi yang jalan dan bisa dilogin. Rahasia yang tidak
 * diset akan dibuat sekali lalu disimpan di volume data, sehingga tetap sama setelah
 * container dibangun ulang — kalau tidak, semua guru ter-logout tiap kali rebuild.
 */

// Docker Compose mengisi env container langsung (lewat `environment:` di
// docker-compose.yml), jadi tidak butuh ini. Tapi `npm run dev`/`npm start`
// tanpa Docker tidak pernah membaca `.env` sama sekali kalau tidak ada baris
// ini — dibungkus try/catch karena filenya sendiri OPSIONAL (prinsip di atas).
try {
  process.loadEnvFile();
} catch {
  // .env tidak ada — semua nilai bawaan di bawah tetap berlaku.
}

function teks(nama: string, bawaan: string): string {
  const v = process.env[nama];
  return v !== undefined && v !== '' ? v : bawaan;
}

function angka(nama: string, bawaan: number): number {
  const v = process.env[nama];
  if (v === undefined || v === '') return bawaan;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Nilai env ${nama} harus berupa angka, diterima: "${v}"`);
  }
  return n;
}

function boolean_(nama: string, bawaan: boolean): boolean {
  const v = process.env[nama];
  if (v === undefined || v === '') return bawaan;
  return ['1', 'true', 'ya', 'yes'].includes(v.toLowerCase());
}

const akarProyek = process.cwd();
const dirData = resolve(akarProyek, teks('DIR_DATA', './data'));

/**
 * Baca rahasia dari berkas; kalau belum ada, buat dan simpan.
 * Disimpan di dalam volume data supaya bertahan melewati rebuild image.
 */
function rahasiaPersisten(namaBerkas: string, panjangByte: number): string {
  const jalur = resolve(dirData, namaBerkas);
  if (existsSync(jalur)) {
    const isi = readFileSync(jalur, 'utf8').trim();
    if (isi.length > 0) return isi;
  }
  const baru = randomBytes(panjangByte).toString('hex');
  mkdirSync(dirname(jalur), { recursive: true });
  writeFileSync(jalur, baru, { encoding: 'utf8', mode: 0o600 });
  return baru;
}

mkdirSync(dirData, { recursive: true });

export const config = {
  appNama: teks('APP_NAMA', 'Refleksi'),
  lingkungan: teks('NODE_ENV', 'development'),
  get produksi() {
    return this.lingkungan === 'production';
  },

  host: teks('HOST', '0.0.0.0'),
  port: angka('PORT', 8080),

  /**
   * Apakah pengguna mengakses aplikasi lewat HTTPS (biasanya diterminasi di
   * reverse proxy seperti nginx/aaPanel, bukan di Node ini).
   *
   * Bawaannya `false` karena pemakaian paling umum aplikasi ini adalah LAN
   * sekolah / domain internal berprotokol http://. Kalau dipaksa `true` padahal
   * aksesnya http://, dua hal langsung rusak: (1) header
   * `upgrade-insecure-requests` membuat browser mencari CSS/JS lewat https
   * sehingga gagal total, dan (2) HSTS "mengunci" domain itu ke https di
   * browser pengguna sampai dibersihkan manual.
   *
   * Setel `PAKAI_HTTPS=true` HANYA setelah proxy benar-benar menyajikan https
   * dengan sertifikat yang valid.
   */
  pakaiHttps: boolean_('PAKAI_HTTPS', false),

  dirData,
  dbPath: resolve(dirData, teks('NAMA_DB', 'refleksi.db')),
  dirUnggahan: resolve(dirData, 'unggahan'),
  dirBackup: resolve(dirData, 'backup'),
  dirWeb: resolve(akarProyek, teks('DIR_WEB', './web/dist')),

  /**
   * Object storage S3-compatible (mis. NevaObjects/Nevacloud) untuk gambar
   * unggahan. Kosongkan salah satu dari empat nilai di bawah untuk memakai
   * bawaan: simpan di disk lokal (`dirUnggahan`, disajikan lewat `/unggahan/`)
   * — sama seperti sebelum fitur ini ada, jadi instalasi lama tidak perlu
   * ganti apa pun.
   */
  s3: {
    endpoint: teks('S3_ENDPOINT', ''),
    region: teks('S3_REGION', 'us-east-1'),
    bucket: teks('S3_BUCKET', ''),
    accessKey: teks('S3_ACCESS_KEY', ''),
    secretKey: teks('S3_SECRET_KEY', ''),
    /** WAJIB diisi untuk Cloudflare R2 (endpoint S3 R2 bersifat privat) —
     *  lihat `layanan/s3Klien.ts`. Kosong = turunkan dari endpoint+bucket. */
    urlPublik: teks('S3_URL_PUBLIK', ''),
    get aktif() {
      return this.endpoint !== '' && this.bucket !== '' && this.accessKey !== '' && this.secretKey !== '';
    },
  },

  redisUrl: teks('REDIS_URL', 'redis://127.0.0.1:6379'),

  /** Dibuat otomatis bila tidak diset — lihat catatan di atas soal rebuild. */
  sessionSecret: teks('SESSION_SECRET', '') || rahasiaPersisten('.rahasia-sesi', 32),
  sessionUmurJam: angka('SESSION_UMUR_JAM', 12),

  /** Akun admin awal. Password dibuat acak bila tidak diset, lalu dicetak ke log. */
  adminUsername: teks('ADMIN_USERNAME', 'admin'),
  adminPassword: teks('ADMIN_PASSWORD', ''),

  /** Backup panas SQLite. 0 = matikan. Bawaan: sekali sehari, simpan 7 snapshot
   *  terakhir (~seminggu) — cukup buat jaring pengaman tanpa disk membengkak. */
  backupTiapMenit: angka('BACKUP_TIAP_MENIT', 1440),
  backupSimpanTerakhir: angka('BACKUP_SIMPAN_TERAKHIR', 7),

  logLevel: teks('LOG_LEVEL', boolean_('DEBUG', false) ? 'debug' : 'info'),
} as const;

export type Config = typeof config;

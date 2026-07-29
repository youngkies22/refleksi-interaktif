import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import { GalatAplikasi, galatTerlaluCepat, galatTidakDiizinkan, galatTidakDitemukan, galatValidasi } from '../galat.js';
import { log } from '../log.js';
import { redisUmum } from '../redis/client.js';
import { kunci } from '../redis/kunci.js';
import { catatLogAdmin } from './logAdmin.js';
import { RATE_LOGIN } from '../../shared/konstanta.js';
import type { Guru, GuruAdmin } from '../../shared/tipe.js';

interface BarisGuru {
  id: number;
  username: string;
  nama: string;
  password_hash: string;
  role: 'admin' | 'guru';
  aktif: number;
}

function keGuruPublik(b: BarisGuru): Guru {
  return { id: b.id, username: b.username, nama: b.nama, role: b.role };
}

function keGuruAdmin(b: BarisGuru): GuruAdmin {
  return { ...keGuruPublik(b), aktif: b.aktif === 1 };
}

/**
 * Verifikasi kredensial. Selalu memakan waktu yang sama untuk username valid
 * maupun tidak valid — bcrypt.compare tetap dijalankan dengan hash palsu supaya
 * tidak membocorkan lewat timing apakah sebuah username terdaftar.
 */
const HASH_PALSU = bcrypt.hashSync('kata-sandi-tidak-akan-pernah-cocok', 12);

/** Baca counter TANPA menaikkannya — dipakai untuk cek kuncian sebelum bcrypt
 *  dijalankan sama sekali (murah, ditolak duluan seperti pola di jawaban.ts). */
async function terkunci(kunciRedis: string, maks: number): Promise<boolean> {
  const nilai = await redisUmum().get(kunciRedis);
  return nilai !== null && Number(nilai) >= maks;
}

async function naikkanCounter(kunciRedis: string, jendelaDetik: number): Promise<void> {
  const redis = redisUmum();
  const n = await redis.incr(kunciRedis);
  if (n === 1) await redis.expire(kunciRedis, jendelaDetik);
}

export async function login(username: string, password: string, ip: string): Promise<Guru> {
  const u = username.trim();
  if (u === '' || password === '') {
    throw galatValidasi('Username dan password wajib diisi.');
  }

  const kunciAkun = kunci.rateLoginAkun(u);
  const kunciIp = kunci.rateLoginIp(ip);

  if (await terkunci(kunciAkun, RATE_LOGIN.maksPerAkun)) {
    throw galatTerlaluCepat('Terlalu banyak percobaan gagal untuk akun ini. Coba lagi dalam beberapa menit.');
  }
  if (await terkunci(kunciIp, RATE_LOGIN.maksPerIp)) {
    throw galatTerlaluCepat('Terlalu banyak percobaan login. Coba lagi dalam beberapa menit.');
  }

  const db = getDb();
  const baris = db
    .prepare('SELECT * FROM guru WHERE username = ?')
    .get(u) as BarisGuru | undefined;

  const cocok = bcrypt.compareSync(password, baris?.password_hash ?? HASH_PALSU);

  if (!baris || !cocok) {
    await naikkanCounter(kunciAkun, RATE_LOGIN.jendelaAkunDetik);
    await naikkanCounter(kunciIp, RATE_LOGIN.jendelaIpDetik);
    log.warn({ username: u }, 'Percobaan login gagal');
    throw galatTidakDiizinkan('Username atau password salah.');
  }

  if (baris.aktif === 0) {
    throw galatTidakDiizinkan('Akun ini sudah dinonaktifkan.');
  }

  await redisUmum().del(kunciAkun);
  return keGuruPublik(baris);
}

export function cariGuruById(id: number): Guru | null {
  const db = getDb();
  const baris = db
    .prepare('SELECT * FROM guru WHERE id = ? AND aktif = 1')
    .get(id) as BarisGuru | undefined;
  return baris ? keGuruPublik(baris) : null;
}

export interface DataUbahProfil {
  nama?: string;
  username?: string;
  /** Wajib diisi kalau `passwordBaru` diisi — mencegah orang lain mengganti
   *  password lewat sesi yang lagi login tanpa tahu password saat ini. */
  passwordLama?: string;
  passwordBaru?: string;
}

export function ubahProfil(guruId: number, data: DataUbahProfil): Guru {
  const db = getDb();
  const baris = db.prepare('SELECT * FROM guru WHERE id = ?').get(guruId) as BarisGuru | undefined;
  if (!baris) throw galatTidakDiizinkan('Akun tidak ditemukan.');

  const nama = data.nama?.trim();
  if (nama !== undefined && nama === '') throw galatValidasi('Nama tidak boleh kosong.');

  const username = data.username?.trim();
  if (username !== undefined) {
    if (username === '') throw galatValidasi('Username tidak boleh kosong.');
    const bentrok = db
      .prepare('SELECT 1 FROM guru WHERE username = ? AND id <> ?')
      .get(username, guruId);
    if (bentrok) throw galatValidasi('Username itu sudah dipakai akun lain.');
  }

  let passwordHashBaru: string | undefined;
  if (data.passwordBaru !== undefined && data.passwordBaru !== '') {
    if (!data.passwordLama) {
      throw galatValidasi('Masukkan password lama untuk mengganti password.');
    }
    if (!bcrypt.compareSync(data.passwordLama, baris.password_hash)) {
      throw galatTidakDiizinkan('Password lama tidak cocok.');
    }
    if (data.passwordBaru.length < 6) {
      throw galatValidasi('Password baru minimal 6 karakter.');
    }
    passwordHashBaru = bcrypt.hashSync(data.passwordBaru, 12);
  }

  db.prepare(
    `UPDATE guru SET
       nama = COALESCE(?, nama),
       username = COALESCE(?, username),
       password_hash = COALESCE(?, password_hash)
     WHERE id = ?`,
  ).run(nama ?? null, username ?? null, passwordHashBaru ?? null, guruId);

  log.info({ guruId, gantiUsername: username !== undefined, gantiPassword: passwordHashBaru !== undefined }, 'Profil guru diubah');

  const setelah = db.prepare('SELECT * FROM guru WHERE id = ?').get(guruId) as BarisGuru;
  return keGuruPublik(setelah);
}

/* ────────────────────────── Superadmin: kelola akun guru ────────────────────────── */

export interface DataBuatGuru {
  username: string;
  nama: string;
  password: string;
  role?: 'admin' | 'guru';
}

export interface DataUbahGuruAdmin {
  nama?: string;
  username?: string;
  password?: string;
  role?: 'admin' | 'guru';
  /** `false` = blokir (tidak bisa login), `true` = aktifkan kembali. */
  aktif?: boolean;
}

export function daftarGuru(): GuruAdmin[] {
  const baris = getDb().prepare('SELECT * FROM guru ORDER BY id').all() as BarisGuru[];
  return baris.map(keGuruAdmin);
}

function namaAdmin(adminId: number): string {
  const b = getDb().prepare('SELECT nama FROM guru WHERE id = ?').get(adminId) as { nama: string } | undefined;
  return b?.nama ?? `#${adminId}`;
}

export function buatGuru(data: DataBuatGuru, adminIdSaatIni: number): GuruAdmin {
  const username = data.username.trim();
  const nama = data.nama.trim();
  if (username === '' || nama === '') throw galatValidasi('Username dan nama wajib diisi.');
  if (data.password.length < 6) throw galatValidasi('Password minimal 6 karakter.');

  const db = getDb();
  const bentrok = db.prepare('SELECT 1 FROM guru WHERE username = ?').get(username);
  if (bentrok) throw galatValidasi('Username itu sudah dipakai.');

  const hash = bcrypt.hashSync(data.password, 12);
  const info = db
    .prepare('INSERT INTO guru (username, nama, password_hash, role, aktif) VALUES (?, ?, ?, ?, 1)')
    .run(username, nama, hash, data.role ?? 'guru');
  const guruId = Number(info.lastInsertRowid);

  log.info({ guruId, username }, 'Akun guru dibuat oleh superadmin');
  catatLogAdmin(adminIdSaatIni, namaAdmin(adminIdSaatIni), 'buat_akun', 'guru', guruId, `Membuat akun "${nama}" (@${username})`);
  return keGuruAdmin(db.prepare('SELECT * FROM guru WHERE id = ?').get(guruId) as BarisGuru);
}

/**
 * `adminIdSaatIni` dipakai mencegah superadmin memblokir akunnya sendiri —
 * tanpa penjagaan ini, satu klik yang salah bisa mengunci semua orang keluar
 * dari panel admin (tidak ada akun lain yang bisa membuka blokirnya).
 */
export function ubahGuruAdmin(id: number, data: DataUbahGuruAdmin, adminIdSaatIni: number): GuruAdmin {
  if (id === adminIdSaatIni && data.aktif === false) {
    throw galatValidasi('Tidak bisa memblokir akun Anda sendiri.');
  }

  const db = getDb();
  const baris = db.prepare('SELECT * FROM guru WHERE id = ?').get(id) as BarisGuru | undefined;
  if (!baris) throw galatTidakDitemukan('Akun guru tidak ditemukan.');

  const nama = data.nama?.trim();
  if (nama !== undefined && nama === '') throw galatValidasi('Nama tidak boleh kosong.');

  const username = data.username?.trim();
  if (username !== undefined) {
    if (username === '') throw galatValidasi('Username tidak boleh kosong.');
    const bentrok = db.prepare('SELECT 1 FROM guru WHERE username = ? AND id <> ?').get(username, id);
    if (bentrok) throw galatValidasi('Username itu sudah dipakai akun lain.');
  }

  let hashBaru: string | undefined;
  if (data.password !== undefined && data.password !== '') {
    if (data.password.length < 6) throw galatValidasi('Password minimal 6 karakter.');
    hashBaru = bcrypt.hashSync(data.password, 12);
  }

  db.prepare(
    `UPDATE guru SET
       nama = COALESCE(?, nama),
       username = COALESCE(?, username),
       password_hash = COALESCE(?, password_hash),
       role = COALESCE(?, role),
       aktif = COALESCE(?, aktif)
     WHERE id = ?`,
  ).run(
    nama ?? null,
    username ?? null,
    hashBaru ?? null,
    data.role ?? null,
    data.aktif === undefined ? null : data.aktif ? 1 : 0,
    id,
  );

  log.info({ guruId: id, adminId: adminIdSaatIni }, 'Akun guru diubah oleh superadmin');

  const perubahan: string[] = [];
  if (nama !== undefined) perubahan.push(`nama → "${nama}"`);
  if (username !== undefined) perubahan.push(`username → "${username}"`);
  if (hashBaru !== undefined) perubahan.push('password diganti');
  if (data.role !== undefined) perubahan.push(`role → ${data.role}`);
  if (data.aktif !== undefined) perubahan.push(data.aktif ? 'diaktifkan kembali' : 'diblokir');
  catatLogAdmin(
    adminIdSaatIni,
    namaAdmin(adminIdSaatIni),
    'ubah_akun',
    'guru',
    id,
    `Akun "${baris.nama}" (@${baris.username}): ${perubahan.join(', ') || 'tidak ada perubahan'}`,
  );

  return keGuruAdmin(db.prepare('SELECT * FROM guru WHERE id = ?').get(id) as BarisGuru);
}

/**
 * PERINGATAN: `guru_id` di tabel presentasi/sesi/papan dideklarasikan
 * `ON DELETE CASCADE` (lihat migrasi) — menghapus akun guru ikut menghapus
 * SEMUA presentasi, sesi, dan papan miliknya. Ini ditegaskan lagi lewat
 * dialog konfirmasi di UI (AdminGuru.vue), bukan hanya di sini.
 */
export function hapusGuru(id: number, adminIdSaatIni: number): void {
  if (id === adminIdSaatIni) throw galatValidasi('Tidak bisa menghapus akun Anda sendiri.');

  const db = getDb();
  const baris = db.prepare('SELECT * FROM guru WHERE id = ?').get(id) as BarisGuru | undefined;
  if (!baris) throw galatTidakDitemukan('Akun guru tidak ditemukan.');

  db.prepare('DELETE FROM guru WHERE id = ?').run(id);

  log.info({ guruId: id, adminId: adminIdSaatIni }, 'Akun guru dihapus oleh superadmin');
  catatLogAdmin(
    adminIdSaatIni,
    namaAdmin(adminIdSaatIni),
    'hapus_akun',
    'guru',
    id,
    `Menghapus akun "${baris.nama}" (@${baris.username}) beserta seluruh presentasi & papannya`,
  );
}

/* ─────────────────────────── Import massal (CSV) ─────────────────────────── */

/**
 * Parser CSV kecil sendiri, BUKAN library pihak ketiga — kebutuhannya cuma 3
 * kolom sederhana (Nama, Username, Password), dan dua library xlsx populer di
 * npm (`xlsx`, `exceljs`) sama-sama membawa celah keamanan dari dependency-nya
 * yang belum ada perbaikan resmi saat baris ini ditulis. Menangani kolom
 * berkutip (`"isi, ada koma"` dan `""` untuk kutip literal) sesuai RFC 4180,
 * cukup untuk berkas hasil "Save As CSV" dari Excel/Google Sheets.
 */
function uraiBarisCsv(baris: string): string[] {
  const kolom: string[] = [];
  let saatIni = '';
  let didalamKutip = false;

  for (let i = 0; i < baris.length; i++) {
    const c = baris[i];
    if (didalamKutip) {
      if (c === '"') {
        if (baris[i + 1] === '"') {
          saatIni += '"';
          i++;
        } else {
          didalamKutip = false;
        }
      } else {
        saatIni += c;
      }
    } else if (c === '"') {
      didalamKutip = true;
    } else if (c === ',') {
      kolom.push(saatIni);
      saatIni = '';
    } else {
      saatIni += c;
    }
  }
  kolom.push(saatIni);
  return kolom;
}

export interface BarisGagalImpor {
  /** Nomor baris di berkas CSV, termasuk header (baris 1) — supaya guru bisa
   *  langsung mencocokkan ke aplikasi spreadsheet-nya. */
  baris: number;
  pesan: string;
}

export interface HasilImporGuru {
  berhasil: GuruAdmin[];
  gagal: BarisGagalImpor[];
}

/**
 * Import banyak akun guru sekaligus dari teks CSV (header: Nama,Username,Password).
 * Baris yang gagal (username bentrok, password terlalu pendek, dst) TIDAK
 * menggagalkan baris lain — tiap baris divalidasi & disimpan secara independen
 * lewat `buatGuru` yang sama seperti form tambah satu-satu, supaya aturannya
 * selalu konsisten di satu tempat.
 */
export function importGuruCsv(teksCsv: string, adminIdSaatIni: number): HasilImporGuru {
  const baris = teksCsv.split(/\r\n|\n/).filter((b) => b.trim() !== '');
  if (baris.length === 0) throw galatValidasi('Berkas CSV kosong.');

  const header = uraiBarisCsv(baris[0]!).map((h) => h.trim().toLowerCase());
  const idxNama = header.indexOf('nama');
  const idxUsername = header.indexOf('username');
  const idxPassword = header.indexOf('password');
  if (idxNama === -1 || idxUsername === -1 || idxPassword === -1) {
    throw galatValidasi('Kolom wajib pada baris pertama (header): Nama, Username, Password.');
  }

  const berhasil: GuruAdmin[] = [];
  const gagal: BarisGagalImpor[] = [];

  for (let i = 1; i < baris.length; i++) {
    const kolom = uraiBarisCsv(baris[i]!);
    try {
      berhasil.push(
        buatGuru(
          {
            nama: kolom[idxNama] ?? '',
            username: kolom[idxUsername] ?? '',
            password: kolom[idxPassword] ?? '',
          },
          adminIdSaatIni,
        ),
      );
    } catch (e) {
      gagal.push({
        baris: i + 1,
        pesan: e instanceof GalatAplikasi ? e.message : 'Gagal membuat akun.',
      });
    }
  }

  log.info({ berhasil: berhasil.length, gagal: gagal.length }, 'Import CSV akun guru selesai');
  return { berhasil, gagal };
}

/** Template CSV kosong (header + satu contoh baris) untuk diunduh admin. */
export function templateImporGuruCsv(): string {
  return ['Nama,Username,Password', 'Contoh Guru,contohguru,katasandi123'].join('\r\n');
}

function csvAman(nilai: unknown): string {
  const s = String(nilai ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Ekspor seluruh akun guru ke CSV — backup/referensi, BUKAN cadangan password:
 * hash bcrypt tidak bisa dibalik ke teks asli, jadi kolom Password sengaja
 * dikosongkan (bukan diisi hash — hash yang bocor tetap risiko keamanan).
 *
 * Header sengaja sama persis dengan yang dibaca `importGuruCsv` (Nama,
 * Username, Password) plus Role & Status untuk referensi — kolom tambahan itu
 * diabaikan begitu saja saat import, jadi berkas ini BISA dipakai ulang untuk
 * import (mis. pindah ke instalasi lain) asal kolom Password diisi manual dulu.
 */
export function eksporGuruCsv(): string {
  const baris = daftarGuru().map((g) =>
    [g.nama, g.username, g.role, g.aktif ? 'aktif' : 'diblokir', ''].map(csvAman).join(','),
  );
  return ['Nama,Username,Role,Status,Password', ...baris].join('\r\n');
}

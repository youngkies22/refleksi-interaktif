import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { galatTidakDitemukan } from '../galat.js';
import { log } from '../log.js';
import { jalankanMigrasi } from './migrasi.js';

/**
 * Lapisan database.
 *
 * `better-sqlite3` bersifat SINKRON. Itu keunggulan (tidak ada overhead jaringan,
 * transaksi sangat cepat) sekaligus jebakan: satu transaksi besar akan membekukan
 * SELURUH socket, bukan cuma satu request. Karena itu setiap penulisan massal wajib
 * dipotong menjadi batch kecil — lihat BATCH_JAWABAN_MAKS di shared/konstanta.ts.
 */

let db: Database.Database | null = null;
let timerBackup: NodeJS.Timeout | null = null;

export function bukaDb(): Database.Database {
  if (db) return db;

  mkdirSync(config.dirData, { recursive: true });
  mkdirSync(config.dirUnggahan, { recursive: true });

  const koneksi = new Database(config.dbPath);

  // WAL: pembaca tidak memblokir penulis. Wajib untuk aplikasi realtime —
  // tanpa ini, satu penulisan batch akan menahan semua pembacaan agregat.
  koneksi.pragma('journal_mode = WAL');

  // NORMAL cukup aman dipadukan dengan WAL dan jauh lebih cepat daripada FULL.
  // Risiko yang tersisa hanya kehilangan transaksi terakhir saat listrik mati
  // mendadak — dapat diterima untuk data jajak pendapat kelas.
  koneksi.pragma('synchronous = NORMAL');

  // Tunggu sampai 5 detik bila database terkunci, jangan langsung SQLITE_BUSY.
  koneksi.pragma('busy_timeout = 5000');

  // ON DELETE CASCADE di skema tidak berlaku tanpa baris ini.
  koneksi.pragma('foreign_keys = ON');

  koneksi.pragma('temp_store = MEMORY');

  jalankanMigrasi(koneksi);

  db = koneksi;
  log.info({ jalur: config.dbPath }, 'Database siap');
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database belum dibuka. Panggil bukaDb() lebih dulu.');
  return db;
}

/* ─────────────────────────────── Backup ─────────────────────────────── */

/**
 * Backup panas memakai API `.backup()` bawaan SQLite — aman dijalankan saat
 * aplikasi sedang melayani, tidak mengunci penulisan.
 *
 * Ini jaring pengaman kedua setelah named volume: volume melindungi dari rebuild
 * image, backup melindungi dari berkas database yang korup atau terhapus.
 */
export async function backupSekarang(): Promise<string | null> {
  const koneksi = getDb();
  try {
    mkdirSync(config.dirBackup, { recursive: true });
    const cap = new Date().toISOString().replace(/[:.]/g, '-');
    const tujuan = resolve(config.dirBackup, `refleksi-${cap}.db`);

    await koneksi.backup(tujuan);
    pangkasBackupLama();

    log.info({ tujuan }, 'Backup database selesai');
    return tujuan;
  } catch (e) {
    // Backup gagal tidak boleh menjatuhkan aplikasi yang sedang dipakai mengajar.
    log.error({ err: e }, 'Backup database gagal');
    return null;
  }
}

function pangkasBackupLama(): void {
  const simpan = config.backupSimpanTerakhir;
  if (simpan <= 0) return;

  const berkas = readdirSync(config.dirBackup)
    .filter((n) => n.startsWith('refleksi-') && n.endsWith('.db'))
    .map((n) => {
      const jalur = resolve(config.dirBackup, n);
      return { jalur, waktu: statSync(jalur).mtimeMs };
    })
    .sort((a, b) => b.waktu - a.waktu);

  for (const lama of berkas.slice(simpan)) {
    try {
      rmSync(lama.jalur, { force: true });
    } catch (e) {
      log.warn({ jalur: lama.jalur, err: e }, 'Gagal menghapus backup lama');
    }
  }
}

export interface InfoBackup {
  nama: string;
  ukuranByte: number;
  dibuatPada: string;
}

/** Snapshot terbaru duluan. Kalau folder backup belum pernah dibuat, kembalikan
 *  daftar kosong alih-alih melempar galat. */
export function daftarBackup(): InfoBackup[] {
  try {
    return readdirSync(config.dirBackup)
      .filter((n) => n.startsWith('refleksi-') && n.endsWith('.db'))
      .map((n) => {
        const jalur = resolve(config.dirBackup, n);
        const s = statSync(jalur);
        return { nama: n, ukuranByte: s.size, dibuatPada: new Date(s.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.dibuatPada.localeCompare(a.dibuatPada));
  } catch {
    return [];
  }
}

/** Validasi nama berkas ketat (bukan cuma "ada di disk") supaya parameter dari
 *  request tidak bisa dipakai buat path traversal ke luar folder backup. */
export function jalurBackup(nama: string): string | null {
  if (!/^refleksi-[\w.-]+\.db$/.test(nama)) return null;
  const jalur = resolve(config.dirBackup, nama);
  return existsSync(jalur) ? jalur : null;
}

/**
 * Timpa database yang sedang aktif dengan salah satu snapshot lama.
 *
 * Sebelum menimpa, kondisi SAAT INI dicadangkan dulu lewat `backupSekarang()` —
 * jaring pengaman kalau ternyata salah pilih snapshot, restore itu sendiri bisa
 * "dibatalkan" dengan restore sekali lagi ke cadangan barusan. Koneksi ditutup
 * rapi dulu (checkpoint WAL) sebelum berkas fisiknya ditimpa, supaya tidak ada
 * proses lain yang menulis ke berkas di tengah proses salin.
 */
export async function pulihkanDariBackup(nama: string): Promise<void> {
  const sumber = jalurBackup(nama);
  if (!sumber) throw galatTidakDitemukan('Berkas snapshot tidak ditemukan.');

  await backupSekarang();

  tutupDb();
  copyFileSync(sumber, config.dbPath);
  // Sidecar WAL/SHM milik database LAMA tidak relevan lagi untuk berkas yang
  // baru saja ditimpa — biarkan SQLite membuat yang baru saat dibuka lagi.
  for (const ext of ['-wal', '-shm']) {
    try {
      rmSync(`${config.dbPath}${ext}`, { force: true });
    } catch {
      // tidak masalah kalau sidecar-nya memang tidak ada
    }
  }

  bukaDb();
  mulaiBackupBerkala();
}

export function mulaiBackupBerkala(): void {
  const menit = config.backupTiapMenit;
  if (menit <= 0) {
    log.info('Backup berkala dimatikan (BACKUP_TIAP_MENIT=0)');
    return;
  }

  timerBackup = setInterval(() => void backupSekarang(), menit * 60_000);
  // Jangan menahan proses tetap hidup hanya karena timer ini.
  timerBackup.unref();
  log.info({ tiapMenit: menit, simpan: config.backupSimpanTerakhir }, 'Backup berkala aktif');
}

/* ─────────────────────────── Penutupan rapi ─────────────────────────── */

/**
 * Tutup database dengan benar.
 *
 * `wal_checkpoint(TRUNCATE)` memindahkan isi WAL kembali ke berkas utama, sehingga
 * `refleksi.db` berdiri sendiri dan aman disalin. Tanpa ini, menyalin berkas .db
 * saja (tanpa -wal dan -shm) bisa kehilangan transaksi terakhir.
 */
export function tutupDb(): void {
  if (!db) return;
  if (timerBackup) clearInterval(timerBackup);

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    log.warn({ err: e }, 'Checkpoint WAL gagal saat penutupan');
  }

  try {
    db.close();
    log.info('Database ditutup rapi');
  } catch (e) {
    log.error({ err: e }, 'Gagal menutup database');
  } finally {
    db = null;
  }
}

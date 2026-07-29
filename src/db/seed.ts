import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { log } from '../log.js';
import { getDb } from './index.js';

/**
 * Seed akun admin — dijalankan sekali saat boot bila tabel `guru` kosong.
 *
 * Password dibuat acak kalau ADMIN_PASSWORD tidak diset, lalu DICETAK KE LOG.
 * Ini memenuhi syarat "sekali jalan, minim error": guru tidak perlu tahu apa pun
 * soal env var untuk bisa login pertama kali — cukup baca `docker compose logs`.
 */
export function seedAdmin(): void {
  const db = getDb();

  const jumlah = (db.prepare('SELECT COUNT(*) AS n FROM guru').get() as { n: number }).n;
  if (jumlah > 0) {
    log.debug({ jumlah }, 'Akun guru sudah ada, lewati seed');
    return;
  }

  const password = config.adminPassword || randomBytes(9).toString('base64url');
  const hash = bcrypt.hashSync(password, 12);

  db.prepare(
    `INSERT INTO guru (username, nama, password_hash, role, aktif) VALUES (?, ?, ?, 'admin', 1)`,
  ).run(config.adminUsername, 'Administrator', hash);

  const garis = '='.repeat(56);
  process.stdout.write(
    `\n${garis}\n` +
      `  AKUN ADMIN DIBUAT — CATAT SEKARANG, TIDAK DITAMPILKAN LAGI\n` +
      `  Username : ${config.adminUsername}\n` +
      `  Password : ${password}\n` +
      `${garis}\n\n`,
  );

  log.info({ username: config.adminUsername }, 'Akun admin awal dibuat');
}

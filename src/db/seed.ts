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

/**
 * Seed konfigurasi S3 dari env var `S3_*` — dijalankan sekali saat boot bila
 * kolom `s3_endpoint` di `pengaturan` masih kosong DAN env var-nya diisi.
 *
 * Sama seperti `seedAdmin()`: sesudah baris pertama ini terisi (baik dari sini
 * maupun ditulis admin lewat panel), env var TIDAK dibaca lagi — supaya admin
 * yang mengubah kredensial lewat panel tidak bingung nilainya "kembali" ke
 * `.env` lama tiap container di-rebuild.
 */
export function seedS3(): void {
  const db = getDb();

  const baris = db.prepare('SELECT s3_endpoint FROM pengaturan WHERE id = 1').get() as {
    s3_endpoint: string | null;
  };
  if (baris.s3_endpoint) {
    log.debug('Konfigurasi S3 sudah ada di database, lewati seed dari env');
    return;
  }
  if (!config.s3.aktif) return; // S3_* tidak diisi di env — tetap pakai disk lokal

  db.prepare(
    `UPDATE pengaturan SET s3_endpoint = ?, s3_region = ?, s3_bucket = ?, s3_access_key = ?, s3_secret_key = ?, s3_url_publik = ? WHERE id = 1`,
  ).run(
    config.s3.endpoint,
    config.s3.region,
    config.s3.bucket,
    config.s3.accessKey,
    config.s3.secretKey,
    config.s3.urlPublik || null,
  );

  log.info({ endpoint: config.s3.endpoint, bucket: config.s3.bucket }, 'Konfigurasi S3 di-seed dari env var');
}

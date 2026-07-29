import type { Database } from 'better-sqlite3';
import { log } from '../log.js';

/**
 * Migrasi ditulis sebagai SQL biasa di dalam berkas TypeScript.
 *
 * Sengaja tidak memakai runner migrasi pihak ketiga: semuanya butuh pemuat berkas
 * dinamis yang rewel begitu kode dikompilasi ke `dist/` dan dijalankan di Docker.
 * SQL yang tertanam di modul selalu ikut ter-bundle, jadi tidak ada berkas yang
 * bisa "lupa tersalin" ke image.
 *
 * Aturan: JANGAN pernah mengubah entri yang sudah pernah rilis — tambah versi baru.
 */

interface Migrasi {
  versi: number;
  nama: string;
  sql: string;
}

const daftar: Migrasi[] = [
  {
    versi: 1,
    nama: 'skema-awal',
    sql: /* sql */ `
      ---------------------------------------------------------------- guru
      CREATE TABLE guru (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    NOT NULL UNIQUE,
        nama          TEXT    NOT NULL,
        password_hash TEXT    NOT NULL,
        role          TEXT    NOT NULL DEFAULT 'guru' CHECK (role IN ('admin','guru')),
        aktif         INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      ------------------------------------------------------- pilar A: sesi live
      CREATE TABLE presentasi (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guru_id    INTEGER NOT NULL REFERENCES guru(id) ON DELETE CASCADE,
        judul      TEXT    NOT NULL,
        deskripsi  TEXT    NOT NULL DEFAULT '',
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_presentasi_guru ON presentasi(guru_id, updated_at DESC);

      CREATE TABLE slide (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        presentasi_id  INTEGER NOT NULL REFERENCES presentasi(id) ON DELETE CASCADE,
        urutan         INTEGER NOT NULL,
        tipe           TEXT    NOT NULL,
        pertanyaan     TEXT    NOT NULL DEFAULT '',
        konfig_json    TEXT    NOT NULL DEFAULT '{}',
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_slide_presentasi ON slide(presentasi_id, urutan);

      CREATE TABLE opsi (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        slide_id INTEGER NOT NULL REFERENCES slide(id) ON DELETE CASCADE,
        urutan   INTEGER NOT NULL,
        teks     TEXT    NOT NULL,
        benar    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_opsi_slide ON opsi(slide_id, urutan);

      CREATE TABLE sesi (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        presentasi_id      INTEGER NOT NULL REFERENCES presentasi(id) ON DELETE CASCADE,
        guru_id            INTEGER NOT NULL REFERENCES guru(id) ON DELETE CASCADE,
        kode               TEXT    NOT NULL,
        status             TEXT    NOT NULL DEFAULT 'menunggu'
                                   CHECK (status IN ('menunggu','berjalan','selesai')),
        slide_aktif_id     INTEGER REFERENCES slide(id) ON DELETE SET NULL,
        izinkan_join_telat INTEGER NOT NULL DEFAULT 1,
        sembunyikan_nama   INTEGER NOT NULL DEFAULT 0,
        mulai_at           TEXT,
        selesai_at         TEXT,
        created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      -- Kode hanya wajib unik selama sesi belum selesai, sehingga kode lama
      -- boleh dipakai ulang di kemudian hari tanpa mengganggu arsip.
      CREATE UNIQUE INDEX idx_sesi_kode_aktif ON sesi(kode) WHERE status <> 'selesai';
      CREATE INDEX idx_sesi_guru ON sesi(guru_id, created_at DESC);

      CREATE TABLE peserta (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        sesi_id      INTEGER NOT NULL REFERENCES sesi(id) ON DELETE CASCADE,
        token        TEXT    NOT NULL,
        nama         TEXT    NOT NULL,
        skor         INTEGER NOT NULL DEFAULT 0,
        joined_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      -- Token unik PER SESI, bukan global: satu HP boleh ikut banyak sesi.
      CREATE UNIQUE INDEX idx_peserta_token ON peserta(sesi_id, token);
      CREATE INDEX idx_peserta_skor ON peserta(sesi_id, skor DESC);

      CREATE TABLE jawaban (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sesi_id       INTEGER NOT NULL REFERENCES sesi(id) ON DELETE CASCADE,
        slide_id      INTEGER NOT NULL REFERENCES slide(id) ON DELETE CASCADE,
        peserta_id    INTEGER NOT NULL REFERENCES peserta(id) ON DELETE CASCADE,
        nilai_teks    TEXT,
        opsi_id       INTEGER REFERENCES opsi(id) ON DELETE SET NULL,
        nilai_angka   REAL,
        nilai_json    TEXT,
        ketepatan     REAL    NOT NULL DEFAULT 0,
        benar         INTEGER NOT NULL DEFAULT 0,
        waktu_ms      INTEGER,
        poin          INTEGER NOT NULL DEFAULT 0,
        disembunyikan INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      -- Indeks utama untuk rehidrasi agregat dari SQLite saat Redis kosong.
      CREATE INDEX idx_jawaban_slide ON jawaban(sesi_id, slide_id);
      CREATE UNIQUE INDEX idx_jawaban_unik ON jawaban(sesi_id, slide_id, peserta_id);

      ------------------------------------------------- pilar B: papan kolaboratif
      CREATE TABLE papan (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        guru_id           INTEGER NOT NULL REFERENCES guru(id) ON DELETE CASCADE,
        kode              TEXT    NOT NULL UNIQUE,
        judul             TEXT    NOT NULL,
        deskripsi         TEXT    NOT NULL DEFAULT '',
        tata_letak        TEXT    NOT NULL DEFAULT 'kolom'
                                  CHECK (tata_letak IN ('kolom','dinding')),
        anonim            INTEGER NOT NULL DEFAULT 1,
        perlu_persetujuan INTEGER NOT NULL DEFAULT 0,
        izinkan_like      INTEGER NOT NULL DEFAULT 1,
        izinkan_komentar  INTEGER NOT NULL DEFAULT 1,
        terkunci          INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_papan_guru ON papan(guru_id, updated_at DESC);

      CREATE TABLE kolom (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        papan_id INTEGER NOT NULL REFERENCES papan(id) ON DELETE CASCADE,
        urutan   INTEGER NOT NULL,
        judul    TEXT    NOT NULL,
        warna    TEXT    NOT NULL DEFAULT 'slate'
      );
      CREATE INDEX idx_kolom_papan ON kolom(papan_id, urutan);

      CREATE TABLE kartu (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        papan_id      INTEGER NOT NULL REFERENCES papan(id) ON DELETE CASCADE,
        kolom_id      INTEGER REFERENCES kolom(id) ON DELETE SET NULL,
        penulis_token TEXT    NOT NULL,
        penulis_nama  TEXT,
        judul         TEXT    NOT NULL DEFAULT '',
        isi           TEXT    NOT NULL DEFAULT '',
        warna         TEXT    NOT NULL DEFAULT 'kuning',
        lampiran_path TEXT,
        lampiran_tipe TEXT,
        urutan        INTEGER NOT NULL DEFAULT 0,
        disetujui     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_kartu_papan ON kartu(papan_id, kolom_id, urutan);
      CREATE INDEX idx_kartu_moderasi ON kartu(papan_id, disetujui);

      CREATE TABLE kartu_like (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kartu_id   INTEGER NOT NULL REFERENCES kartu(id) ON DELETE CASCADE,
        token      TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_like_unik ON kartu_like(kartu_id, token);

      CREATE TABLE komentar (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        kartu_id      INTEGER NOT NULL REFERENCES kartu(id) ON DELETE CASCADE,
        penulis_token TEXT    NOT NULL,
        penulis_nama  TEXT,
        isi           TEXT    NOT NULL,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_komentar_kartu ON komentar(kartu_id, created_at);
    `,
  },
  {
    versi: 2,
    nama: 'log-admin',
    sql: /* sql */ `
      ------------------------------------------------------- log aktivitas admin
      -- admin_nama sengaja disalin apa adanya (bukan JOIN ke guru) supaya
      -- riwayat tetap terbaca walau akun admin itu sendiri kelak diganti nama
      -- atau dihapus — log tidak boleh berubah retroaktif.
      CREATE TABLE log_admin (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id    INTEGER REFERENCES guru(id) ON DELETE SET NULL,
        admin_nama  TEXT    NOT NULL,
        aksi        TEXT    NOT NULL,
        target_tipe TEXT    NOT NULL,
        target_id   INTEGER,
        detail      TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_log_admin_waktu ON log_admin(created_at DESC);
    `,
  },
  {
    versi: 3,
    nama: 'pengaturan-aplikasi',
    sql: /* sql */ `
      ------------------------------------------------- pengaturan aplikasi (branding)
      -- Baris tunggal (CHECK id=1) — bukan key/value umum, karena baru ada dua
      -- field dan keduanya dipakai berdampingan tiap kali (nama tab + logo header).
      CREATE TABLE pengaturan (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        nama_aplikasi TEXT    NOT NULL DEFAULT 'Refleksi',
        logo_path     TEXT,
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO pengaturan (id, nama_aplikasi) VALUES (1, 'Refleksi');
    `,
  },
];

/**
 * Jalankan migrasi yang belum pernah diterapkan.
 *
 * Tiap migrasi dibungkus transaksi sendiri: kalau versi 3 gagal, versi 1–2 tetap
 * tercatat dan tidak perlu diulang. `better-sqlite3` sinkron, jadi tidak ada
 * kondisi balapan di sini.
 */
export function jalankanMigrasi(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrasi (
      versi         INTEGER PRIMARY KEY,
      nama          TEXT NOT NULL,
      dijalankan_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const sudah = new Set(
    db.prepare('SELECT versi FROM _migrasi').all().map((r) => (r as { versi: number }).versi),
  );

  const tertunda = daftar
    .filter((m) => !sudah.has(m.versi))
    .sort((a, b) => a.versi - b.versi);

  if (tertunda.length === 0) {
    log.debug({ jumlahVersi: sudah.size }, 'Skema database sudah mutakhir');
    return;
  }

  const catat = db.prepare('INSERT INTO _migrasi (versi, nama) VALUES (?, ?)');

  for (const m of tertunda) {
    const terapkan = db.transaction(() => {
      db.exec(m.sql);
      catat.run(m.versi, m.nama);
    });

    try {
      terapkan();
      log.info({ versi: m.versi, nama: m.nama }, 'Migrasi diterapkan');
    } catch (e) {
      log.error({ versi: m.versi, nama: m.nama, err: e }, 'Migrasi GAGAL — dibatalkan');
      throw e;
    }
  }
}

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { galatSesiDitutup, galatTidakDiizinkan, galatTidakDitemukan, galatValidasi } from '../galat.js';
import { log } from '../log.js';
import { redisUmum } from '../redis/client.js';
import { kunci } from '../redis/kunci.js';
import { buatKode, normalisasiKode } from '../util/kode.js';
import { BATAS, TTL_SESI_DETIK } from '../../shared/konstanta.js';
import type {
  Kartu,
  Kolom,
  Komentar,
  Papan,
  RingkasPapan,
  RingkasPapanAdmin,
  TataLetakPapan,
} from '../../shared/tipe.js';

/**
 * Papan kolaboratif Padlet.
 *
 * Beda mendasar dari sesi live: papan TIDAK punya sumber kebenaran di Redis.
 * Kartu ditulis langsung ke SQLite (volumenya rendah — bukan burst 500 jawaban
 * serempak seperti sesi kuis), jadi tidak perlu lapisan cache-aside seperti
 * `redis/agregat.ts`. Redis di sini hanya untuk lookup kode→id dan pelacakan
 * "sedang online", persis seperti kode/hadir di sesi live.
 */

interface BarisPapan {
  id: number;
  guru_id: number;
  kode: string;
  judul: string;
  deskripsi: string;
  tata_letak: string;
  anonim: number;
  perlu_persetujuan: number;
  izinkan_like: number;
  izinkan_komentar: number;
  terkunci: number;
}

interface BarisKartu {
  id: number;
  papan_id: number;
  kolom_id: number | null;
  penulis_token: string;
  penulis_nama: string | null;
  judul: string;
  isi: string;
  warna: string;
  lampiran_path: string | null;
  urutan: number;
  disetujui: number;
  created_at: string;
}

function papanKePublik(b: BarisPapan): Papan {
  return {
    id: b.id,
    kode: b.kode,
    judul: b.judul,
    deskripsi: b.deskripsi,
    tataLetak: b.tata_letak as TataLetakPapan,
    anonim: b.anonim === 1,
    perluPersetujuan: b.perlu_persetujuan === 1,
    izinkanLike: b.izinkan_like === 1,
    izinkanKomentar: b.izinkan_komentar === 1,
    terkunci: b.terkunci === 1,
  };
}

function ambilPapan(id: number): BarisPapan {
  const b = getDb().prepare('SELECT * FROM papan WHERE id = ?').get(id) as BarisPapan | undefined;
  if (!b) throw galatTidakDitemukan('Papan tidak ditemukan.');
  return b;
}

export function papanMilikGuru(id: number, guruId: number): BarisPapan {
  const b = ambilPapan(id);
  if (b.guru_id !== guruId) throw galatTidakDitemukan('Papan tidak ditemukan.');
  return b;
}

/* ────────────────────────────────── CRUD Papan (guru) ────────────────────────────────── */

export function daftarPapan(guruId: number): RingkasPapan[] {
  const baris = getDb()
    .prepare(
      `SELECT p.id, p.kode, p.judul, p.updated_at,
              (SELECT COUNT(*) FROM kartu k WHERE k.papan_id = p.id) AS jumlah_kartu,
              (SELECT COUNT(*) FROM kartu k WHERE k.papan_id = p.id AND k.disetujui = 0) AS jumlah_menunggu
       FROM papan p
       WHERE p.guru_id = ?
       ORDER BY p.updated_at DESC`,
    )
    .all(guruId) as (BarisPapan & { updated_at: string; jumlah_kartu: number; jumlah_menunggu: number })[];

  return baris.map((b) => ({
    id: b.id,
    kode: b.kode,
    judul: b.judul,
    jumlahKartu: b.jumlah_kartu,
    jumlahMenunggu: b.jumlah_menunggu,
    updatedAt: b.updated_at,
  }));
}

/** Superadmin saja: seluruh papan lintas guru, dengan info pemiliknya
 *  ter-JOIN langsung (satu query, bukan N+1 per guru). */
export function daftarSemuaPapan(): RingkasPapanAdmin[] {
  const baris = getDb()
    .prepare(
      `SELECT p.id, p.kode, p.judul, p.updated_at,
              (SELECT COUNT(*) FROM kartu k WHERE k.papan_id = p.id) AS jumlah_kartu,
              (SELECT COUNT(*) FROM kartu k WHERE k.papan_id = p.id AND k.disetujui = 0) AS jumlah_menunggu,
              g.id AS guru_id, g.nama AS guru_nama, g.username AS guru_username
       FROM papan p
       JOIN guru g ON g.id = p.guru_id
       ORDER BY p.updated_at DESC`,
    )
    .all() as (BarisPapan & {
    updated_at: string;
    jumlah_kartu: number;
    jumlah_menunggu: number;
    guru_id: number;
    guru_nama: string;
    guru_username: string;
  })[];

  return baris.map((b) => ({
    id: b.id,
    kode: b.kode,
    judul: b.judul,
    jumlahKartu: b.jumlah_kartu,
    jumlahMenunggu: b.jumlah_menunggu,
    updatedAt: b.updated_at,
    guruId: b.guru_id,
    guruNama: b.guru_nama,
    guruUsername: b.guru_username,
  }));
}

export function buatPapan(guruId: number, judul: string): { id: number; kode: string } {
  const j = judul.trim();
  if (j === '') throw galatValidasi('Judul papan wajib diisi.');
  if (j.length > BATAS.judulPresentasi) {
    throw galatValidasi(`Judul maksimal ${BATAS.judulPresentasi} karakter.`);
  }

  const db = getDb();
  let kodeTerpilih: string | null = null;
  for (let i = 0; i < 10; i++) {
    const kandidat = buatKode();
    const bentrok = db.prepare('SELECT 1 FROM papan WHERE kode = ?').get(kandidat);
    if (!bentrok) {
      kodeTerpilih = kandidat;
      break;
    }
  }
  if (!kodeTerpilih) throw new Error('Gagal membuat kode papan unik setelah 10 percobaan.');

  const buat = db.transaction(() => {
    // Kolom `anonim` di skema DEFAULT-nya 1 (jaga-jaga privasi kalau ada baris
    // ditulis lewat jalur lain) — tapi papan BARU dari editor guru sengaja
    // ditimpa jadi 0 di sini. Bawaan "anonim aktif" membingungkan: guru
    // mengetik nama saat join lalu bingung kartu tertulis "Anonim" tanpa
    // pernah mengaktifkan mode anonim itu sendiri.
    const info = db
      .prepare('INSERT INTO papan (guru_id, kode, judul, anonim) VALUES (?, ?, ?, 0)')
      .run(guruId, kodeTerpilih, j);
    const papanId = Number(info.lastInsertRowid);

    const tambahKolom = db.prepare(
      'INSERT INTO kolom (papan_id, urutan, judul, warna) VALUES (?, ?, ?, ?)',
    );
    tambahKolom.run(papanId, 0, 'Ide', 'blue');
    tambahKolom.run(papanId, 1, 'Sedang Dikerjakan', 'amber');
    tambahKolom.run(papanId, 2, 'Selesai', 'emerald');

    return papanId;
  });

  return { id: buat(), kode: kodeTerpilih };
}

/**
 * Salin papan: judul, pengaturan, dan struktur kolom ikut disalin — tapi TIDAK
 * kartu-nya. Kartu adalah kiriman siswa untuk sesi tertentu, bukan bagian dari
 * "template" yang masuk akal dibawa ke papan baru.
 */
export function duplikatPapan(papanId: number, guruId: number): { id: number; kode: string } {
  const asli = papanMilikGuru(papanId, guruId);
  const db = getDb();

  let kodeTerpilih: string | null = null;
  for (let i = 0; i < 10; i++) {
    const kandidat = buatKode();
    const bentrok = db.prepare('SELECT 1 FROM papan WHERE kode = ?').get(kandidat);
    if (!bentrok) {
      kodeTerpilih = kandidat;
      break;
    }
  }
  if (!kodeTerpilih) throw new Error('Gagal membuat kode papan unik setelah 10 percobaan.');

  const duplikat = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO papan
           (guru_id, kode, judul, deskripsi, tata_letak, anonim, perlu_persetujuan, izinkan_like, izinkan_komentar)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guruId,
        kodeTerpilih,
        `${asli.judul} (salinan)`,
        asli.deskripsi,
        asli.tata_letak,
        asli.anonim,
        asli.perlu_persetujuan,
        asli.izinkan_like,
        asli.izinkan_komentar,
      );
    const papanBaruId = Number(info.lastInsertRowid);

    const kolomAsli = kolomPapan(papanId);
    const tambahKolom = db.prepare('INSERT INTO kolom (papan_id, urutan, judul, warna) VALUES (?, ?, ?, ?)');
    for (const k of kolomAsli) tambahKolom.run(papanBaruId, k.urutan, k.judul, k.warna);

    return papanBaruId;
  });

  return { id: duplikat(), kode: kodeTerpilih };
}

export function detailPapanUntukGuru(
  papanId: number,
  guruId: number,
): { papan: Papan; kolom: Kolom[]; kartu: Kartu[] } {
  const baris = papanMilikGuru(papanId, guruId);
  const kolom = kolomPapan(papanId);
  const kartu = kartuPapan(papanId, null, true); // guru melihat SEMUA, termasuk yang menunggu
  return { papan: papanKePublik(baris), kolom, kartu };
}

/** Superadmin saja: detail papan APAPUN, tanpa cek kepemilikan. */
export function detailPapanAdmin(papanId: number): { papan: Papan; kolom: Kolom[]; kartu: Kartu[] } {
  const baris = ambilPapan(papanId);
  const kolom = kolomPapan(papanId);
  const kartu = kartuPapan(papanId, null, true);
  return { papan: papanKePublik(baris), kolom, kartu };
}

export interface DataUbahPapan {
  judul?: string;
  deskripsi?: string;
  tataLetak?: TataLetakPapan;
  anonim?: boolean;
  perluPersetujuan?: boolean;
  izinkanLike?: boolean;
  izinkanKomentar?: boolean;
  terkunci?: boolean;
}

export function ubahPapan(papanId: number, guruId: number, data: DataUbahPapan): void {
  papanMilikGuru(papanId, guruId);
  const db = getDb();

  if (data.judul !== undefined && data.judul.trim() === '') {
    throw galatValidasi('Judul tidak boleh kosong.');
  }

  db.prepare(
    `UPDATE papan SET
       judul = COALESCE(?, judul),
       deskripsi = COALESCE(?, deskripsi),
       tata_letak = COALESCE(?, tata_letak),
       anonim = COALESCE(?, anonim),
       perlu_persetujuan = COALESCE(?, perlu_persetujuan),
       izinkan_like = COALESCE(?, izinkan_like),
       izinkan_komentar = COALESCE(?, izinkan_komentar),
       terkunci = COALESCE(?, terkunci),
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    data.judul?.trim() ?? null,
    data.deskripsi ?? null,
    data.tataLetak ?? null,
    data.anonim === undefined ? null : data.anonim ? 1 : 0,
    data.perluPersetujuan === undefined ? null : data.perluPersetujuan ? 1 : 0,
    data.izinkanLike === undefined ? null : data.izinkanLike ? 1 : 0,
    data.izinkanKomentar === undefined ? null : data.izinkanKomentar ? 1 : 0,
    data.terkunci === undefined ? null : data.terkunci ? 1 : 0,
    papanId,
  );
}

export function hapusPapan(papanId: number, guruId: number): void {
  papanMilikGuru(papanId, guruId);
  getDb().prepare('DELETE FROM papan WHERE id = ?').run(papanId);
}

interface BarisKartuCsv {
  kolom_judul: string | null;
  penulis_nama: string | null;
  judul: string;
  isi: string;
  disetujui: number;
  jumlah_like: number;
  jumlah_komentar: number;
  created_at: string;
}

function csvAman(nilai: unknown): string {
  const s = String(nilai ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Ekspor seluruh kartu papan ke CSV — arsip guru sebelum papan direset untuk
 * kelas berikutnya. Jumlah like & komentar diambil lewat subquery berkorelasi
 * dalam SATU query (bukan query per kartu), sama seperti rekap sesi.
 *
 * Kartu yang masih menunggu moderasi IKUT diekspor dan ditandai di kolom
 * "Status" — justru itu yang sering perlu ditinjau guru di luar jam pelajaran.
 */
export function csvKartuPapan(papanId: number, guruId: number): string {
  papanMilikGuru(papanId, guruId);

  const baris = getDb()
    .prepare(
      `SELECT ko.judul AS kolom_judul, k.penulis_nama, k.judul, k.isi, k.disetujui,
              (SELECT COUNT(*) FROM kartu_like l WHERE l.kartu_id = k.id) AS jumlah_like,
              (SELECT COUNT(*) FROM komentar c WHERE c.kartu_id = k.id) AS jumlah_komentar,
              k.created_at
       FROM kartu k
       LEFT JOIN kolom ko ON ko.id = k.kolom_id
       WHERE k.papan_id = ?
       ORDER BY ko.urutan, k.urutan, k.id`,
    )
    .all(papanId) as BarisKartuCsv[];

  const kolom = ['Kolom', 'Penulis', 'Judul', 'Isi', 'Status', 'Like', 'Komentar', 'Dibuat'];

  const isi = baris.map((b) =>
    [
      b.kolom_judul ?? '(tanpa kolom)',
      b.penulis_nama ?? 'Anonim',
      b.judul,
      b.isi,
      b.disetujui === 1 ? 'tampil' : 'menunggu persetujuan',
      b.jumlah_like,
      b.jumlah_komentar,
      b.created_at,
    ]
      .map(csvAman)
      .join(','),
  );

  return [kolom.join(','), ...isi].join('\n');
}

/**
 * Kosongkan papan: semua kartu (beserta like & komentarnya lewat CASCADE)
 * dihapus, tapi KOLOM dan pengaturan papan dipertahankan — guru bisa langsung
 * memakai papan yang sama untuk kelas berikutnya tanpa menyusun ulang kolom
 * "Sudah Paham / Masih Bingung / Ingin Tahu Lebih".
 *
 * Mengembalikan jumlah kartu yang terhapus supaya UI bisa memberi konfirmasi
 * yang jujur ("12 kartu dihapus"), bukan sekadar "berhasil".
 */
export function resetPapan(papanId: number, guruId: number): { dihapus: number } {
  papanMilikGuru(papanId, guruId);
  const info = getDb().prepare('DELETE FROM kartu WHERE papan_id = ?').run(papanId);
  log.info({ papanId, dihapus: info.changes }, 'Papan direset (semua kartu dihapus)');
  return { dihapus: info.changes };
}

export function tambahKolom(papanId: number, guruId: number, judul: string, warna: string): { id: number } {
  papanMilikGuru(papanId, guruId);
  const j = judul.trim();
  if (j === '') throw galatValidasi('Judul kolom wajib diisi.');

  const db = getDb();
  const urutanBerikut = (
    db.prepare('SELECT COALESCE(MAX(urutan), -1) + 1 AS n FROM kolom WHERE papan_id = ?').get(papanId) as {
      n: number;
    }
  ).n;

  const info = db
    .prepare('INSERT INTO kolom (papan_id, urutan, judul, warna) VALUES (?, ?, ?, ?)')
    .run(papanId, urutanBerikut, j, warna || 'slate');
  return { id: Number(info.lastInsertRowid) };
}

export function hapusKolom(kolomId: number, guruId: number): void {
  const db = getDb();
  const baris = db
    .prepare(
      `SELECT k.id, k.papan_id FROM kolom k JOIN papan p ON p.id = k.papan_id WHERE k.id = ? AND p.guru_id = ?`,
    )
    .get(kolomId, guruId) as { id: number; papan_id: number } | undefined;
  if (!baris) throw galatTidakDitemukan('Kolom tidak ditemukan.');

  // Kartu di kolom yang dihapus dipindah ke "tanpa kolom" (ON DELETE SET NULL di skema).
  db.prepare('DELETE FROM kolom WHERE id = ?').run(kolomId);
}

/* ─────────────────────────────── Join & kode ─────────────────────────────── */

export async function cariPapanIdDariKode(kodeMentah: string): Promise<number | null> {
  const redis = redisUmum();
  const dariRedis = await redis.get(kunci.kodePapan(kodeMentah));
  if (dariRedis) return Number(dariRedis);

  const baris = getDb().prepare('SELECT id FROM papan WHERE kode = ?').get(kodeMentah) as
    | { id: number }
    | undefined;
  if (!baris) return null;

  await redis.set(kunci.kodePapan(kodeMentah), String(baris.id), 'EX', TTL_SESI_DETIK);
  return baris.id;
}

function kolomPapan(papanId: number): Kolom[] {
  const baris = getDb()
    .prepare('SELECT id, urutan, judul, warna FROM kolom WHERE papan_id = ? ORDER BY urutan')
    .all(papanId) as { id: number; urutan: number; judul: string; warna: string }[];
  return baris;
}

interface BarisKartuLengkap extends BarisKartu {
  jumlah_like: number;
  jumlah_komentar: number;
}

function barisKeKartu(b: BarisKartuLengkap, token: string | null): Kartu {
  return {
    id: b.id,
    kolomId: b.kolom_id,
    penulisNama: b.penulis_nama,
    judul: b.judul,
    isi: b.isi,
    warna: b.warna,
    lampiranPath: b.lampiran_path,
    urutan: b.urutan,
    disetujui: b.disetujui === 1,
    jumlahLike: b.jumlah_like,
    jumlahKomentar: b.jumlah_komentar,
    milikSaya: token !== null && b.penulis_token === token,
    createdAt: b.created_at,
  };
}

/**
 * Bulk-fetch kartu + jumlah like + jumlah komentar dengan SUBQUERY berkorelasi
 * (bukan N+1 manual di sisi aplikasi) — satu round-trip ke SQLite untuk berapa
 * pun jumlah kartu di papan.
 */
function kartuPapan(papanId: number, token: string | null, sertakanMenunggu: boolean): Kartu[] {
  const filterDisetujui = sertakanMenunggu ? '' : 'AND k.disetujui = 1';
  const baris = getDb()
    .prepare(
      `SELECT k.*,
              (SELECT COUNT(*) FROM kartu_like l WHERE l.kartu_id = k.id) AS jumlah_like,
              (SELECT COUNT(*) FROM komentar c WHERE c.kartu_id = k.id) AS jumlah_komentar
       FROM kartu k
       WHERE k.papan_id = ? ${filterDisetujui}
       ORDER BY k.kolom_id, k.urutan`,
    )
    .all(papanId) as BarisKartuLengkap[];

  return baris.map((b) => barisKeKartu(b, token));
}

/** Satu kartu lengkap (dengan jumlah like/komentar) — dipakai setelah mutasi
 *  (pindah/setujui) yang perlu menyiarkan bentuk `Kartu` utuh, bukan sebagian. */
function ambilKartuLengkap(kartuId: number, token: string | null): Kartu {
  const b = getDb()
    .prepare(
      `SELECT k.*,
              (SELECT COUNT(*) FROM kartu_like l WHERE l.kartu_id = k.id) AS jumlah_like,
              (SELECT COUNT(*) FROM komentar c WHERE c.kartu_id = k.id) AS jumlah_komentar
       FROM kartu k WHERE k.id = ?`,
    )
    .get(kartuId) as BarisKartuLengkap | undefined;
  if (!b) throw galatTidakDitemukan('Kartu tidak ditemukan.');
  return barisKeKartu(b, token);
}

export interface HasilMasukPapan {
  token: string;
  papan: Papan;
  kolom: Kolom[];
  kartu: Kartu[];
}

export async function masukPapan(kodeMentah: string, tokenLama?: string): Promise<HasilMasukPapan> {
  const papanId = await cariPapanIdDariKode(kodeMentah);
  if (!papanId) throw galatTidakDitemukan('Kode papan tidak ditemukan.');

  const baris = ambilPapan(papanId);
  const token = tokenLama ?? randomUUID();

  await redisUmum().zadd(kunci.papanHadir(papanId), Date.now(), token);

  return {
    token,
    papan: papanKePublik(baris),
    kolom: kolomPapan(papanId),
    kartu: kartuPapan(papanId, token, false), // publik: hanya yang sudah disetujui
  };
}

/* ───────────────────────────────── Kartu (publik) ───────────────────────────────── */

function ambilKartu(kartuId: number): BarisKartu {
  const b = getDb().prepare('SELECT * FROM kartu WHERE id = ?').get(kartuId) as BarisKartu | undefined;
  if (!b) throw galatTidakDitemukan('Kartu tidak ditemukan.');
  return b;
}

export function tambahKartu(
  papanId: number,
  token: string,
  penulisNamaMentah: string | null,
  data: { kolomId: number | null; judul: string; isi: string; warna: string; lampiranPath?: string },
): Kartu {
  const papan = ambilPapan(papanId);
  if (papan.terkunci === 1) throw galatSesiDitutup('Papan ini sudah dikunci, tidak menerima kartu baru.');

  const judul = data.judul.trim().slice(0, BATAS.kartuJudul);
  const isi = data.isi.trim().slice(0, BATAS.kartuIsi);
  if (judul === '' && isi === '' && !data.lampiranPath) {
    throw galatValidasi('Kartu tidak boleh kosong.');
  }

  // Nama penulis TIDAK pernah disimpan kalau papan diset anonim — bukan cuma
  // disembunyikan di tampilan, tapi memang tidak pernah masuk ke baris DB.
  const penulisNama =
    papan.anonim === 1 ? null : penulisNamaMentah?.trim().slice(0, BATAS.nama) || null;

  const db = getDb();
  const urutanBerikut = (
    db
      .prepare('SELECT COALESCE(MAX(urutan), -1) + 1 AS n FROM kartu WHERE papan_id = ? AND kolom_id IS ?')
      .get(papanId, data.kolomId) as { n: number }
  ).n;

  const disetujui = papan.perlu_persetujuan === 1 ? 0 : 1;

  const info = db
    .prepare(
      `INSERT INTO kartu (papan_id, kolom_id, penulis_token, penulis_nama, judul, isi, warna, lampiran_path, urutan, disetujui)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      papanId,
      data.kolomId,
      token,
      penulisNama,
      judul,
      isi,
      data.warna || 'kuning',
      data.lampiranPath ?? null,
      urutanBerikut,
      disetujui,
    );

  db.prepare(`UPDATE papan SET updated_at = datetime('now') WHERE id = ?`).run(papanId);

  return {
    id: Number(info.lastInsertRowid),
    kolomId: data.kolomId,
    penulisNama,
    judul,
    isi,
    warna: data.warna || 'kuning',
    lampiranPath: data.lampiranPath ?? null,
    urutan: urutanBerikut,
    disetujui: disetujui === 1,
    jumlahLike: 0,
    jumlahKomentar: 0,
    milikSaya: true,
    createdAt: new Date().toISOString(),
  };
}

export function ubahKartu(kartuId: number, token: string, data: { judul?: string; isi?: string }): Kartu {
  const baris = ambilKartu(kartuId);
  if (baris.penulis_token !== token) throw galatTidakDiizinkan('Bukan kartu milikmu.');

  getDb()
    .prepare(`UPDATE kartu SET judul = COALESCE(?, judul), isi = COALESCE(?, isi) WHERE id = ?`)
    .run(
      data.judul !== undefined ? data.judul.trim().slice(0, BATAS.kartuJudul) : null,
      data.isi !== undefined ? data.isi.trim().slice(0, BATAS.kartuIsi) : null,
      kartuId,
    );

  return ambilKartuLengkap(kartuId, token);
}

/** Drag kartu antar kolom — sengaja TERBUKA untuk siapa pun yang sudah join,
 *  bukan hanya penulis. Ini soal mengorganisir papan bersama, bukan mengedit isi. */
export function pindahKartu(kartuId: number, kolomId: number | null, urutan: number): Kartu {
  ambilKartu(kartuId); // 404 kalau tidak ada
  getDb().prepare('UPDATE kartu SET kolom_id = ?, urutan = ? WHERE id = ?').run(kolomId, urutan, kartuId);
  return ambilKartuLengkap(kartuId, null);
}

export function hapusKartu(kartuId: number, token: string, guruId?: number): { papanId: number } {
  const baris = ambilKartu(kartuId);
  if (baris.penulis_token !== token) {
    if (!guruId) throw galatTidakDiizinkan('Bukan kartu milikmu.');
    const papan = ambilPapan(baris.papan_id);
    if (papan.guru_id !== guruId) throw galatTidakDiizinkan('Bukan kartu milikmu.');
  }
  getDb().prepare('DELETE FROM kartu WHERE id = ?').run(kartuId);
  return { papanId: baris.papan_id };
}

export async function toggleLike(kartuId: number, token: string): Promise<{ jumlah: number }> {
  ambilKartu(kartuId); // 404 kalau tidak ada
  const db = getDb();

  const sudah = db.prepare('SELECT 1 FROM kartu_like WHERE kartu_id = ? AND token = ?').get(kartuId, token);
  if (sudah) {
    db.prepare('DELETE FROM kartu_like WHERE kartu_id = ? AND token = ?').run(kartuId, token);
  } else {
    db.prepare('INSERT INTO kartu_like (kartu_id, token) VALUES (?, ?)').run(kartuId, token);
  }

  const jumlah = (
    db.prepare('SELECT COUNT(*) AS n FROM kartu_like WHERE kartu_id = ?').get(kartuId) as { n: number }
  ).n;
  return { jumlah };
}

export function tambahKomentar(kartuId: number, token: string, nama: string, isiMentah: string): Komentar {
  ambilKartu(kartuId);
  const isi = isiMentah.trim().slice(0, BATAS.komentar);
  if (isi === '') throw galatValidasi('Komentar tidak boleh kosong.');

  const info = getDb()
    .prepare('INSERT INTO komentar (kartu_id, penulis_token, penulis_nama, isi) VALUES (?, ?, ?, ?)')
    .run(kartuId, token, nama.trim().slice(0, BATAS.nama) || null, isi);

  return {
    id: Number(info.lastInsertRowid),
    nama: nama.trim() || null,
    isi,
    createdAt: new Date().toISOString(),
  };
}

export function komentarKartu(kartuId: number): Komentar[] {
  ambilKartu(kartuId); // 404 kalau tidak ada
  const baris = getDb()
    .prepare('SELECT id, penulis_nama, isi, created_at FROM komentar WHERE kartu_id = ? ORDER BY created_at')
    .all(kartuId) as { id: number; penulis_nama: string | null; isi: string; created_at: string }[];
  return baris.map((b) => ({ id: b.id, nama: b.penulis_nama, isi: b.isi, createdAt: b.created_at }));
}

/* ─────────────────────────────────── Moderasi ─────────────────────────────────── */

export function setujuiKartu(kartuId: number, guruId: number): { kartu: Kartu; papanId: number } {
  const baris = ambilKartu(kartuId);
  papanMilikGuru(baris.papan_id, guruId);

  getDb().prepare('UPDATE kartu SET disetujui = 1 WHERE id = ?').run(kartuId);
  return { kartu: ambilKartuLengkap(kartuId, null), papanId: baris.papan_id };
}

export async function jumlahMenunggu(papanId: number): Promise<number> {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM kartu WHERE papan_id = ? AND disetujui = 0')
      .get(papanId) as { n: number }
  ).n;
}

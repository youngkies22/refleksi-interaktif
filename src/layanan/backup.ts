import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { galatTidakDitemukan, galatValidasi } from '../galat.js';
import { log } from '../log.js';
import { buatKode } from '../util/kode.js';
import { BATAS } from '../../shared/konstanta.js';
import type { Database } from 'better-sqlite3';

/**
 * Backup & restore presentasi/papan dalam bentuk JSON.
 *
 * Dua jalur pakai bangunan yang sama:
 *  - ADMIN (bawah file ini): SELURUH presentasi & papan, semua guru sekaligus,
 *    dirujuk lewat username (lihat rute/api/admin.ts) — untuk pindah instalasi.
 *  - GURU (juga bawah): satu presentasi/papan milik SENDIRI per-kartu di
 *    dashboard (lihat rute/api/presentasi.ts & papan.ts) — untuk duplikasi
 *    cepat atau backup pribadi. Kepemilikan pada import jalur guru SELALU
 *    dipaksa ke akun yang sedang login, tidak pernah dipercaya dari isi berkas.
 *
 * SENGAJA tidak termasuk riwayat sesi live (sesi/peserta/jawaban) — itu data
 * historis kelas yang sudah lewat, bukan konten yang diedit ulang.
 */

const VERSI_BACKUP = 1;

export interface BackupOpsi {
  urutan: number;
  teks: string;
  benar: boolean;
}

export interface BackupSlide {
  urutan: number;
  tipe: string;
  pertanyaan: string;
  // Bentuknya beda per tipe slide (lihat KonfigSlide di shared/tipe.ts) — di
  // sini cukup dianggap blob buram yang disalin apa adanya, sama seperti
  // kolom `konfig_json` di database.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  konfig: any;
  opsi: BackupOpsi[];
}

export interface BackupKomentar {
  nama: string | null;
  isi: string;
}

export interface BackupKartu {
  /** null = kartu "tanpa kolom"; kalau ada, dicocokkan ke kolom lewat urutan
   *  (BUKAN id — id kolom pasti beda setelah di-import ulang). */
  kolomUrutan: number | null;
  penulisNama: string | null;
  judul: string;
  isi: string;
  warna: string;
  lampiranPath: string | null;
  urutan: number;
  disetujui: boolean;
  /** Jumlah like, BUKAN token asli peserta — token lama tidak berarti apa-apa
   *  di instalasi/akun baru. Saat import, dibuatkan token acak sejumlah ini
   *  supaya angkanya tetap tampil sama. */
  jumlahLike: number;
  komentar: BackupKomentar[];
}

export interface BackupKolom {
  urutan: number;
  judul: string;
  warna: string;
}

export interface BackupLampiran {
  namaBerkas: string;
  base64: string;
}

const POLA_PATH_UNGGAHAN = /^\/unggahan\/(.+)$/;

type PencatatLampiran = (path: unknown) => void;

function buatPencatatLampiran(map: Map<string, string>): PencatatLampiran {
  return (path) => {
    if (typeof path !== 'string') return;
    const cocok = POLA_PATH_UNGGAHAN.exec(path);
    if (!cocok) return;
    const namaBerkas = cocok[1]!;
    if (map.has(namaBerkas)) return;

    const jalur = resolve(config.dirUnggahan, namaBerkas);
    if (!existsSync(jalur)) return;
    map.set(namaBerkas, readFileSync(jalur).toString('base64'));
  };
}

/** Tulis lampiran ke disk — idempotent (berkas yang sudah ada tidak ditimpa),
 *  supaya import yang dijalankan dua kali tidak merusak gambar yang sudah ada. */
function tulisLampiranKeDisk(lampiran: BackupLampiran[] | undefined): void {
  for (const l of lampiran ?? []) {
    const jalur = resolve(config.dirUnggahan, l.namaBerkas);
    if (!existsSync(jalur)) writeFileSync(jalur, Buffer.from(l.base64, 'base64'));
  }
}

/* ─────────────────────── Baca (dipakai jalur ekspor) ─────────────────────── */

function bacaSlideUntukPresentasi(
  db: Database,
  presentasiId: number,
  catatLampiran: PencatatLampiran,
): BackupSlide[] {
  const barisSlide = db
    .prepare('SELECT * FROM slide WHERE presentasi_id = ? ORDER BY urutan')
    .all(presentasiId) as { id: number; urutan: number; tipe: string; pertanyaan: string; konfig_json: string }[];

  const idSlide = barisSlide.map((s) => s.id);
  const opsiPerSlide = new Map<number, BackupOpsi[]>();
  if (idSlide.length > 0) {
    const ph = idSlide.map(() => '?').join(',');
    const barisOpsi = db
      .prepare(`SELECT * FROM opsi WHERE slide_id IN (${ph}) ORDER BY slide_id, urutan`)
      .all(...idSlide) as { slide_id: number; urutan: number; teks: string; benar: number }[];
    for (const o of barisOpsi) {
      const arr = opsiPerSlide.get(o.slide_id) ?? [];
      arr.push({ urutan: o.urutan, teks: o.teks, benar: o.benar === 1 });
      opsiPerSlide.set(o.slide_id, arr);
    }
  }

  return barisSlide.map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const konfig: any = JSON.parse(s.konfig_json);
    catatLampiran(konfig?.gambar_path);
    return { urutan: s.urutan, tipe: s.tipe, pertanyaan: s.pertanyaan, konfig, opsi: opsiPerSlide.get(s.id) ?? [] };
  });
}

function bacaKolomKartuUntukPapan(
  db: Database,
  papanId: number,
  catatLampiran: PencatatLampiran,
): { kolom: BackupKolom[]; kartu: BackupKartu[] } {
  const kolomIdKeUrutan = new Map<number, number>();
  const barisKolom = db
    .prepare('SELECT * FROM kolom WHERE papan_id = ? ORDER BY urutan')
    .all(papanId) as { id: number; urutan: number; judul: string; warna: string }[];
  const kolom: BackupKolom[] = barisKolom.map((k) => {
    kolomIdKeUrutan.set(k.id, k.urutan);
    return { urutan: k.urutan, judul: k.judul, warna: k.warna };
  });

  const barisKartu = db
    .prepare(
      `SELECT k.*, (SELECT COUNT(*) FROM kartu_like l WHERE l.kartu_id = k.id) AS jumlah_like
       FROM kartu k WHERE k.papan_id = ? ORDER BY k.kolom_id, k.urutan`,
    )
    .all(papanId) as {
    id: number;
    kolom_id: number | null;
    penulis_nama: string | null;
    judul: string;
    isi: string;
    warna: string;
    lampiran_path: string | null;
    urutan: number;
    disetujui: number;
    jumlah_like: number;
  }[];

  const idKartu = barisKartu.map((k) => k.id);
  const komentarPerKartu = new Map<number, BackupKomentar[]>();
  if (idKartu.length > 0) {
    const ph = idKartu.map(() => '?').join(',');
    const barisKomentar = db
      .prepare(`SELECT * FROM komentar WHERE kartu_id IN (${ph}) ORDER BY kartu_id, created_at`)
      .all(...idKartu) as { kartu_id: number; penulis_nama: string | null; isi: string }[];
    for (const c of barisKomentar) {
      const arr = komentarPerKartu.get(c.kartu_id) ?? [];
      arr.push({ nama: c.penulis_nama, isi: c.isi });
      komentarPerKartu.set(c.kartu_id, arr);
    }
  }

  const kartu: BackupKartu[] = barisKartu.map((k) => {
    catatLampiran(k.lampiran_path);
    return {
      kolomUrutan: k.kolom_id !== null ? (kolomIdKeUrutan.get(k.kolom_id) ?? null) : null,
      penulisNama: k.penulis_nama,
      judul: k.judul,
      isi: k.isi,
      warna: k.warna,
      lampiranPath: k.lampiran_path,
      urutan: k.urutan,
      disetujui: k.disetujui === 1,
      jumlahLike: k.jumlah_like,
      komentar: komentarPerKartu.get(k.id) ?? [],
    };
  });

  return { kolom, kartu };
}

/* ─────────────────────── Tulis (dipakai jalur impor) ─────────────────────── */

function tulisSlideOpsi(db: Database, presentasiId: number, slideList: BackupSlide[]): void {
  for (const s of slideList) {
    const infoSlide = db
      .prepare(`INSERT INTO slide (presentasi_id, urutan, tipe, pertanyaan, konfig_json) VALUES (?, ?, ?, ?, ?)`)
      .run(presentasiId, s.urutan, s.tipe, (s.pertanyaan ?? '').slice(0, BATAS.pertanyaan), JSON.stringify(s.konfig ?? {}));
    const slideId = Number(infoSlide.lastInsertRowid);

    for (const o of s.opsi ?? []) {
      db.prepare('INSERT INTO opsi (slide_id, urutan, teks, benar) VALUES (?, ?, ?, ?)').run(
        slideId,
        o.urutan,
        o.teks.slice(0, BATAS.opsiTeks),
        o.benar ? 1 : 0,
      );
    }
  }
}

function kodePapanUnik(db: Database): string {
  for (let i = 0; i < 10; i++) {
    const kandidat = buatKode();
    const bentrok = db.prepare('SELECT 1 FROM papan WHERE kode = ?').get(kandidat);
    if (!bentrok) return kandidat;
  }
  throw new Error('Gagal membuat kode papan unik setelah 10 percobaan.');
}

function tulisKolomKartu(db: Database, papanId: number, kolomList: BackupKolom[], kartuList: BackupKartu[]): void {
  const urutanKeKolomId = new Map<number, number>();
  for (const k of kolomList) {
    const infoKolom = db
      .prepare('INSERT INTO kolom (papan_id, urutan, judul, warna) VALUES (?, ?, ?, ?)')
      .run(papanId, k.urutan, k.judul, k.warna || 'slate');
    urutanKeKolomId.set(k.urutan, Number(infoKolom.lastInsertRowid));
  }

  const tambahLike = db.prepare('INSERT INTO kartu_like (kartu_id, token) VALUES (?, ?)');
  const tambahKomentar = db.prepare(
    'INSERT INTO komentar (kartu_id, penulis_token, penulis_nama, isi) VALUES (?, ?, ?, ?)',
  );

  for (const k of kartuList) {
    const kolomId = k.kolomUrutan !== null ? (urutanKeKolomId.get(k.kolomUrutan) ?? null) : null;
    const infoKartu = db
      .prepare(
        `INSERT INTO kartu
           (papan_id, kolom_id, penulis_token, penulis_nama, judul, isi, warna, lampiran_path, urutan, disetujui)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        papanId,
        kolomId,
        `impor-${randomUUID()}`,
        k.penulisNama,
        (k.judul ?? '').slice(0, BATAS.kartuJudul),
        (k.isi ?? '').slice(0, BATAS.kartuIsi),
        k.warna || 'kuning',
        k.lampiranPath,
        k.urutan,
        k.disetujui ? 1 : 0,
      );
    const kartuId = Number(infoKartu.lastInsertRowid);

    for (let n = 0; n < (k.jumlahLike ?? 0); n++) {
      tambahLike.run(kartuId, `impor-${randomUUID()}`);
    }
    for (const c of k.komentar ?? []) {
      tambahKomentar.run(kartuId, `impor-${randomUUID()}`, c.nama, c.isi.slice(0, BATAS.komentar));
    }
  }
}

/* ═══════════════════════════ Jalur ADMIN (semua guru) ═══════════════════════════ */

export interface BackupPresentasi {
  guruUsername: string;
  judul: string;
  deskripsi: string;
  slide: BackupSlide[];
}

export interface BackupPapan {
  guruUsername: string;
  judul: string;
  deskripsi: string;
  tataLetak: string;
  anonim: boolean;
  perluPersetujuan: boolean;
  izinkanLike: boolean;
  izinkanKomentar: boolean;
  terkunci: boolean;
  kolom: BackupKolom[];
  kartu: BackupKartu[];
}

export interface BackupKonten {
  versi: number;
  dibuatPada: string;
  lampiran: BackupLampiran[];
  presentasi: BackupPresentasi[];
  papan: BackupPapan[];
}

export function eksporKontenJson(): BackupKonten {
  const db = getDb();
  const lampiranMap = new Map<string, string>();
  const catat = buatPencatatLampiran(lampiranMap);

  const barisPresentasi = db
    .prepare(
      `SELECT p.id, p.judul, p.deskripsi, g.username
       FROM presentasi p JOIN guru g ON g.id = p.guru_id
       ORDER BY p.id`,
    )
    .all() as { id: number; judul: string; deskripsi: string; username: string }[];

  const presentasi: BackupPresentasi[] = barisPresentasi.map((p) => ({
    guruUsername: p.username,
    judul: p.judul,
    deskripsi: p.deskripsi,
    slide: bacaSlideUntukPresentasi(db, p.id, catat),
  }));

  const barisPapan = db
    .prepare(
      `SELECT p.id, p.judul, p.deskripsi, p.tata_letak, p.anonim, p.perlu_persetujuan,
              p.izinkan_like, p.izinkan_komentar, p.terkunci, g.username
       FROM papan p JOIN guru g ON g.id = p.guru_id
       ORDER BY p.id`,
    )
    .all() as {
    id: number;
    judul: string;
    deskripsi: string;
    tata_letak: string;
    anonim: number;
    perlu_persetujuan: number;
    izinkan_like: number;
    izinkan_komentar: number;
    terkunci: number;
    username: string;
  }[];

  const papan: BackupPapan[] = barisPapan.map((p) => {
    const { kolom, kartu } = bacaKolomKartuUntukPapan(db, p.id, catat);
    return {
      guruUsername: p.username,
      judul: p.judul,
      deskripsi: p.deskripsi,
      tataLetak: p.tata_letak,
      anonim: p.anonim === 1,
      perluPersetujuan: p.perlu_persetujuan === 1,
      izinkanLike: p.izinkan_like === 1,
      izinkanKomentar: p.izinkan_komentar === 1,
      terkunci: p.terkunci === 1,
      kolom,
      kartu,
    };
  });

  log.info(
    { presentasi: presentasi.length, papan: papan.length, lampiran: lampiranMap.size },
    'Ekspor backup konten (admin) dibuat',
  );

  return {
    versi: VERSI_BACKUP,
    dibuatPada: new Date().toISOString(),
    lampiran: [...lampiranMap].map(([namaBerkas, base64]) => ({ namaBerkas, base64 })),
    presentasi,
    papan,
  };
}

interface BarisGagalKonten {
  judul: string;
  pesan: string;
}

export interface HasilImporKonten {
  presentasi: { berhasil: number; gagal: BarisGagalKonten[] };
  papan: { berhasil: number; gagal: BarisGagalKonten[] };
}

function pastikanBentukBackup(data: unknown): asserts data is BackupKonten {
  const d = data as Partial<BackupKonten> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.presentasi) || !Array.isArray(d.papan)) {
    throw galatValidasi('Berkas backup tidak valid atau bukan format yang dikenal.');
  }
}

export function importKontenJson(data: unknown): HasilImporKonten {
  pastikanBentukBackup(data);
  const db = getDb();
  tulisLampiranKeDisk(data.lampiran);

  function guruIdDariUsername(username: string): number | null {
    const baris = db.prepare('SELECT id FROM guru WHERE username = ?').get(username) as
      | { id: number }
      | undefined;
    return baris?.id ?? null;
  }

  const hasilPresentasi: HasilImporKonten['presentasi'] = { berhasil: 0, gagal: [] };
  for (const p of data.presentasi) {
    const guruId = guruIdDariUsername(p.guruUsername);
    if (!guruId) {
      hasilPresentasi.gagal.push({
        judul: p.judul,
        pesan: `Guru "${p.guruUsername}" tidak ditemukan — impor akun guru itu dulu lewat CSV.`,
      });
      continue;
    }
    try {
      db.transaction(() => {
        const info = db
          .prepare('INSERT INTO presentasi (guru_id, judul, deskripsi) VALUES (?, ?, ?)')
          .run(guruId, p.judul.trim().slice(0, BATAS.judulPresentasi), p.deskripsi ?? '');
        tulisSlideOpsi(db, Number(info.lastInsertRowid), p.slide);
      })();
      hasilPresentasi.berhasil++;
    } catch (e) {
      hasilPresentasi.gagal.push({ judul: p.judul, pesan: e instanceof Error ? e.message : 'Gagal mengimpor presentasi.' });
    }
  }

  const hasilPapan: HasilImporKonten['papan'] = { berhasil: 0, gagal: [] };
  for (const p of data.papan) {
    const guruId = guruIdDariUsername(p.guruUsername);
    if (!guruId) {
      hasilPapan.gagal.push({
        judul: p.judul,
        pesan: `Guru "${p.guruUsername}" tidak ditemukan — impor akun guru itu dulu lewat CSV.`,
      });
      continue;
    }
    try {
      db.transaction(() => {
        const infoPapan = db
          .prepare(
            `INSERT INTO papan
               (guru_id, kode, judul, deskripsi, tata_letak, anonim, perlu_persetujuan, izinkan_like, izinkan_komentar, terkunci)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            guruId,
            kodePapanUnik(db),
            p.judul.trim(),
            p.deskripsi ?? '',
            p.tataLetak || 'kolom',
            p.anonim ? 1 : 0,
            p.perluPersetujuan ? 1 : 0,
            p.izinkanLike ? 1 : 0,
            p.izinkanKomentar ? 1 : 0,
            p.terkunci ? 1 : 0,
          );
        tulisKolomKartu(db, Number(infoPapan.lastInsertRowid), p.kolom, p.kartu);
      })();
      hasilPapan.berhasil++;
    } catch (e) {
      hasilPapan.gagal.push({ judul: p.judul, pesan: e instanceof Error ? e.message : 'Gagal mengimpor papan.' });
    }
  }

  log.info({ presentasi: hasilPresentasi.berhasil, papan: hasilPapan.berhasil }, 'Import backup konten (admin) selesai');
  return { presentasi: hasilPresentasi, papan: hasilPapan };
}

/* ═══════════════════ Jalur GURU (satu presentasi/papan milik sendiri) ═══════════════════ */

export interface BackupItemPresentasi {
  versi: number;
  tipe: 'presentasi';
  dibuatPada: string;
  lampiran: BackupLampiran[];
  judul: string;
  deskripsi: string;
  slide: BackupSlide[];
}

export interface BackupItemPapan {
  versi: number;
  tipe: 'papan';
  dibuatPada: string;
  lampiran: BackupLampiran[];
  judul: string;
  deskripsi: string;
  tataLetak: string;
  anonim: boolean;
  perluPersetujuan: boolean;
  izinkanLike: boolean;
  izinkanKomentar: boolean;
  terkunci: boolean;
  kolom: BackupKolom[];
  kartu: BackupKartu[];
}

export function eksporPresentasiSatu(id: number, guruId: number): BackupItemPresentasi {
  const db = getDb();
  const p = db.prepare('SELECT * FROM presentasi WHERE id = ? AND guru_id = ?').get(id, guruId) as
    | { judul: string; deskripsi: string }
    | undefined;
  if (!p) throw galatTidakDitemukan('Presentasi tidak ditemukan.');

  const lampiranMap = new Map<string, string>();
  const slide = bacaSlideUntukPresentasi(db, id, buatPencatatLampiran(lampiranMap));

  return {
    versi: VERSI_BACKUP,
    tipe: 'presentasi',
    dibuatPada: new Date().toISOString(),
    lampiran: [...lampiranMap].map(([namaBerkas, base64]) => ({ namaBerkas, base64 })),
    judul: p.judul,
    deskripsi: p.deskripsi,
    slide,
  };
}

export function eksporPapanSatu(id: number, guruId: number): BackupItemPapan {
  const db = getDb();
  const p = db.prepare('SELECT * FROM papan WHERE id = ? AND guru_id = ?').get(id, guruId) as
    | {
        judul: string;
        deskripsi: string;
        tata_letak: string;
        anonim: number;
        perlu_persetujuan: number;
        izinkan_like: number;
        izinkan_komentar: number;
        terkunci: number;
      }
    | undefined;
  if (!p) throw galatTidakDitemukan('Papan tidak ditemukan.');

  const lampiranMap = new Map<string, string>();
  const { kolom, kartu } = bacaKolomKartuUntukPapan(db, id, buatPencatatLampiran(lampiranMap));

  return {
    versi: VERSI_BACKUP,
    tipe: 'papan',
    dibuatPada: new Date().toISOString(),
    lampiran: [...lampiranMap].map(([namaBerkas, base64]) => ({ namaBerkas, base64 })),
    judul: p.judul,
    deskripsi: p.deskripsi,
    tataLetak: p.tata_letak,
    anonim: p.anonim === 1,
    perluPersetujuan: p.perlu_persetujuan === 1,
    izinkanLike: p.izinkan_like === 1,
    izinkanKomentar: p.izinkan_komentar === 1,
    terkunci: p.terkunci === 1,
    kolom,
    kartu,
  };
}

function pastikanItemPresentasi(data: unknown): asserts data is BackupItemPresentasi {
  const d = data as Partial<BackupItemPresentasi> | null;
  if (!d || typeof d !== 'object' || d.tipe !== 'presentasi' || typeof d.judul !== 'string' || !Array.isArray(d.slide)) {
    throw galatValidasi('Berkas bukan backup presentasi yang valid (atau berasal dari fitur yang berbeda).');
  }
}

function pastikanItemPapan(data: unknown): asserts data is BackupItemPapan {
  const d = data as Partial<BackupItemPapan> | null;
  if (!d || typeof d !== 'object' || d.tipe !== 'papan' || typeof d.judul !== 'string' || !Array.isArray(d.kolom) || !Array.isArray(d.kartu)) {
    throw galatValidasi('Berkas bukan backup papan yang valid (atau berasal dari fitur yang berbeda).');
  }
}

/**
 * Import presentasi milik SENDIRI dari berkas backup satu-item. `guruId`
 * SELALU dari sesi login yang sedang aktif — tidak ada field kepemilikan di
 * berkas jalur ini (beda dari jalur admin yang merujuk `guruUsername`),
 * supaya guru tidak mungkin menaruh presentasi ke akun guru lain hanya
 * dengan mengunggah berkas yang disunting.
 */
export function importPresentasiSatu(guruId: number, data: unknown): { id: number } {
  pastikanItemPresentasi(data);
  const db = getDb();
  tulisLampiranKeDisk(data.lampiran);

  return db.transaction(() => {
    const info = db
      .prepare('INSERT INTO presentasi (guru_id, judul, deskripsi) VALUES (?, ?, ?)')
      .run(guruId, (data.judul.trim() || 'Tanpa judul').slice(0, BATAS.judulPresentasi), data.deskripsi ?? '');
    const presentasiId = Number(info.lastInsertRowid);
    tulisSlideOpsi(db, presentasiId, data.slide);
    return { id: presentasiId };
  })();
}

/** Sama seperti `importPresentasiSatu`, untuk papan. */
export function importPapanSatu(guruId: number, data: unknown): { id: number } {
  pastikanItemPapan(data);
  const db = getDb();
  tulisLampiranKeDisk(data.lampiran);

  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO papan
           (guru_id, kode, judul, deskripsi, tata_letak, anonim, perlu_persetujuan, izinkan_like, izinkan_komentar, terkunci)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guruId,
        kodePapanUnik(db),
        data.judul.trim() || 'Tanpa judul',
        data.deskripsi ?? '',
        data.tataLetak || 'kolom',
        data.anonim ? 1 : 0,
        data.perluPersetujuan ? 1 : 0,
        data.izinkanLike ? 1 : 0,
        data.izinkanKomentar ? 1 : 0,
        data.terkunci ? 1 : 0,
      );
    const papanId = Number(info.lastInsertRowid);
    tulisKolomKartu(db, papanId, data.kolom, data.kartu);
    return { id: papanId };
  })();
}

import { getDb } from '../db/index.js';
import { galatTidakDitemukan, galatValidasi } from '../galat.js';
import { BATAS } from '../../shared/konstanta.js';
import {
  SEMUA_TIPE_SLIDE,
  slideBerpoin,
  type DetailPresentasi,
  type KonfigSlide,
  type Opsi,
  type RingkasPresentasi,
  type RingkasPresentasiAdmin,
  type Slide,
  type TipeSlide,
} from '../../shared/tipe.js';

/**
 * CRUD presentasi + slide + opsi.
 *
 * Prinsip kepemilikan: setiap fungsi yang menerima `guruId` memverifikasi baris
 * itu benar milik guru tersebut, dan melempar **404** (bukan 403) kalau bukan —
 * supaya guru lain tidak bisa memastikan sebuah ID presentasi/slide itu "ada
 * tapi bukan milik saya" hanya dari kode status.
 */

interface BarisPresentasi {
  id: number;
  guru_id: number;
  judul: string;
  deskripsi: string;
  updated_at: string;
}

interface BarisSlide {
  id: number;
  presentasi_id: number;
  urutan: number;
  tipe: string;
  pertanyaan: string;
  konfig_json: string;
}

interface BarisOpsi {
  id: number;
  slide_id: number;
  urutan: number;
  teks: string;
  benar: number;
}

/* ────────────────────────────────── Presentasi ────────────────────────────────── */

export function daftarPresentasi(guruId: number): RingkasPresentasi[] {
  const db = getDb();
  const baris = db
    .prepare(
      `SELECT p.id, p.judul, p.deskripsi, p.updated_at,
              (SELECT COUNT(*) FROM slide s WHERE s.presentasi_id = p.id) AS jumlah_slide
       FROM presentasi p
       WHERE p.guru_id = ?
       ORDER BY p.updated_at DESC`,
    )
    .all(guruId) as (BarisPresentasi & { jumlah_slide: number })[];

  return baris.map((b) => ({
    id: b.id,
    judul: b.judul,
    deskripsi: b.deskripsi,
    jumlahSlide: b.jumlah_slide,
    updatedAt: b.updated_at,
  }));
}

/** Superadmin saja: seluruh presentasi lintas guru, dengan info pemiliknya
 *  ter-JOIN langsung (satu query, bukan N+1 per guru). */
export function daftarSemuaPresentasi(): RingkasPresentasiAdmin[] {
  const db = getDb();
  const baris = db
    .prepare(
      `SELECT p.id, p.judul, p.deskripsi, p.updated_at,
              (SELECT COUNT(*) FROM slide s WHERE s.presentasi_id = p.id) AS jumlah_slide,
              g.id AS guru_id, g.nama AS guru_nama, g.username AS guru_username
       FROM presentasi p
       JOIN guru g ON g.id = p.guru_id
       ORDER BY p.updated_at DESC`,
    )
    .all() as (BarisPresentasi & {
    jumlah_slide: number;
    guru_id: number;
    guru_nama: string;
    guru_username: string;
  })[];

  return baris.map((b) => ({
    id: b.id,
    judul: b.judul,
    deskripsi: b.deskripsi,
    jumlahSlide: b.jumlah_slide,
    updatedAt: b.updated_at,
    guruId: b.guru_id,
    guruNama: b.guru_nama,
    guruUsername: b.guru_username,
  }));
}

export function buatPresentasi(guruId: number, judul: string): { id: number } {
  const j = judul.trim();
  if (j === '') throw galatValidasi('Judul presentasi wajib diisi.');
  if (j.length > BATAS.judulPresentasi) {
    throw galatValidasi(`Judul maksimal ${BATAS.judulPresentasi} karakter.`);
  }

  const db = getDb();
  const info = db
    .prepare('INSERT INTO presentasi (guru_id, judul) VALUES (?, ?)')
    .run(guruId, j);
  return { id: Number(info.lastInsertRowid) };
}

/**
 * Salin presentasi: judul, deskripsi, dan seluruh slide + opsi ikut disalin.
 * Lampiran gambar (mis. `gambar_path` di konfig `pin_jawaban`) TIDAK perlu
 * digandakan di disk — konfig JSON disalin apa adanya, jadi kedua presentasi
 * cukup menunjuk ke berkas fisik yang sama (aset statis, bukan milik satu
 * presentasi secara eksklusif).
 */
export function duplikatPresentasi(id: number, guruId: number): { id: number } {
  const asli = ambilPresentasiMilik(id, guruId);
  const db = getDb();

  const duplikat = db.transaction(() => {
    const infoP = db
      .prepare('INSERT INTO presentasi (guru_id, judul, deskripsi) VALUES (?, ?, ?)')
      .run(guruId, `${asli.judul} (salinan)`, asli.deskripsi);
    const presentasiBaruId = Number(infoP.lastInsertRowid);

    const slideAsli = db
      .prepare('SELECT * FROM slide WHERE presentasi_id = ? ORDER BY urutan')
      .all(id) as BarisSlide[];

    const tambahSlide = db.prepare(
      `INSERT INTO slide (presentasi_id, urutan, tipe, pertanyaan, konfig_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const tambahOpsi = db.prepare('INSERT INTO opsi (slide_id, urutan, teks, benar) VALUES (?, ?, ?, ?)');

    for (const s of slideAsli) {
      const infoS = tambahSlide.run(presentasiBaruId, s.urutan, s.tipe, s.pertanyaan, s.konfig_json);
      const slideBaruId = Number(infoS.lastInsertRowid);

      const opsiAsli = db.prepare('SELECT * FROM opsi WHERE slide_id = ? ORDER BY urutan').all(s.id) as BarisOpsi[];
      for (const o of opsiAsli) tambahOpsi.run(slideBaruId, o.urutan, o.teks, o.benar);
    }

    return presentasiBaruId;
  });

  return { id: duplikat() };
}

function ambilPresentasiMilik(id: number, guruId: number): BarisPresentasi {
  const db = getDb();
  const baris = db.prepare('SELECT * FROM presentasi WHERE id = ?').get(id) as
    | BarisPresentasi
    | undefined;
  if (!baris || baris.guru_id !== guruId) {
    throw galatTidakDitemukan('Presentasi tidak ditemukan.');
  }
  return baris;
}

/**
 * Detail lengkap + seluruh slide + opsi, dibaca dengan TIGA query ber-IN-clause
 * (presentasi, semua slide-nya, semua opsi dari slide-slide itu) — bukan N+1
 * per slide. Untuk presentasi ber-slide banyak ini penting: 20 slide seharusnya
 * tetap 3 query, bukan 1 + 20.
 */
function detailDariBarisPresentasi(p: BarisPresentasi): DetailPresentasi {
  const db = getDb();

  const barisSlide = db
    .prepare('SELECT * FROM slide WHERE presentasi_id = ? ORDER BY urutan')
    .all(p.id) as BarisSlide[];

  const idSlide = barisSlide.map((s) => s.id);
  let opsiPerSlide = new Map<number, Opsi[]>();

  if (idSlide.length > 0) {
    const placeholder = idSlide.map(() => '?').join(',');
    const barisOpsi = db
      .prepare(`SELECT * FROM opsi WHERE slide_id IN (${placeholder}) ORDER BY slide_id, urutan`)
      .all(...idSlide) as BarisOpsi[];

    opsiPerSlide = new Map();
    for (const o of barisOpsi) {
      const daftar = opsiPerSlide.get(o.slide_id) ?? [];
      // `benar` sengaja TIDAK disertakan di sini — endpoint edit guru memakai
      // fungsi terpisah `opsiUntukEditor` yang membocorkannya secara sadar;
      // fungsi ini dipakai juga oleh jalur yang mungkin suatu saat diserahkan
      // ke tampilan lain, jadi baiknya aman secara default.
      daftar.push({ id: o.id, urutan: o.urutan, teks: o.teks, benar: o.benar === 1 });
      opsiPerSlide.set(o.slide_id, daftar);
    }
  }

  const slide: Slide[] = barisSlide.map((s) => ({
    id: s.id,
    urutan: s.urutan,
    tipe: s.tipe as TipeSlide,
    pertanyaan: s.pertanyaan,
    konfig: JSON.parse(s.konfig_json) as KonfigSlide,
    opsi: opsiPerSlide.get(s.id) ?? [],
  }));

  return { id: p.id, judul: p.judul, deskripsi: p.deskripsi, slide };
}

export function detailPresentasi(id: number, guruId: number): DetailPresentasi {
  return detailDariBarisPresentasi(ambilPresentasiMilik(id, guruId));
}

/** Superadmin saja: detail presentasi APAPUN, tanpa cek kepemilikan. */
export function detailPresentasiAdmin(id: number): DetailPresentasi {
  const db = getDb();
  const baris = db.prepare('SELECT * FROM presentasi WHERE id = ?').get(id) as BarisPresentasi | undefined;
  if (!baris) throw galatTidakDitemukan('Presentasi tidak ditemukan.');
  return detailDariBarisPresentasi(baris);
}

export function ubahPresentasi(
  id: number,
  guruId: number,
  data: { judul?: string; deskripsi?: string },
): void {
  ambilPresentasiMilik(id, guruId);
  const db = getDb();

  const judul = data.judul?.trim();
  if (judul !== undefined) {
    if (judul === '') throw galatValidasi('Judul tidak boleh kosong.');
    if (judul.length > BATAS.judulPresentasi) {
      throw galatValidasi(`Judul maksimal ${BATAS.judulPresentasi} karakter.`);
    }
  }

  db.prepare(
    `UPDATE presentasi
     SET judul = COALESCE(?, judul), deskripsi = COALESCE(?, deskripsi), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(judul ?? null, data.deskripsi ?? null, id);
}

export function hapusPresentasi(id: number, guruId: number): void {
  ambilPresentasiMilik(id, guruId);
  getDb().prepare('DELETE FROM presentasi WHERE id = ?').run(id);
  // slide, opsi, sesi, peserta, jawaban ikut terhapus lewat ON DELETE CASCADE.
}

/* ──────────────────────────────────── Slide ──────────────────────────────────── */

function pastikanTipeValid(tipe: string): asserts tipe is TipeSlide {
  if (!(SEMUA_TIPE_SLIDE as readonly string[]).includes(tipe)) {
    throw galatValidasi(`Tipe slide "${tipe}" tidak dikenal.`);
  }
}

/** Slide baru dibuat dengan bawaan minimal yang masuk akal per tipe. */
function konfigBawaan(tipe: TipeSlide): KonfigSlide {
  if (slideBerpoin(tipe)) return { batas_detik: 20, poin_aktif: true };
  if (tipe === 'skala') return { min: 1, maks: 5 };
  if (tipe === 'wordcloud') return { maks_kata: 3 };
  return {};
}

function slideMilik(slideId: number, guruId: number): BarisSlide {
  const db = getDb();
  const baris = db
    .prepare(
      `SELECT s.* FROM slide s
       JOIN presentasi p ON p.id = s.presentasi_id
       WHERE s.id = ? AND p.guru_id = ?`,
    )
    .get(slideId, guruId) as BarisSlide | undefined;
  if (!baris) throw galatTidakDitemukan('Slide tidak ditemukan.');
  return baris;
}

export function tambahSlide(presentasiId: number, guruId: number, tipe: string): { id: number } {
  ambilPresentasiMilik(presentasiId, guruId);
  pastikanTipeValid(tipe);

  const db = getDb();
  const urutanBerikut =
    (
      db
        .prepare('SELECT COALESCE(MAX(urutan), -1) + 1 AS n FROM slide WHERE presentasi_id = ?')
        .get(presentasiId) as { n: number }
    ).n;

  const buatSlideDanOpsiBawaan = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO slide (presentasi_id, urutan, tipe, pertanyaan, konfig_json)
         VALUES (?, ?, ?, '', ?)`,
      )
      .run(presentasiId, urutanBerikut, tipe, JSON.stringify(konfigBawaan(tipe)));
    const slideId = Number(info.lastInsertRowid);

    // benar_salah selalu punya persis dua opsi tetap — tidak diedit lewat
    // editor opsi umum, supaya guru tidak bisa membuat slide benar/salah
    // yang janggal (mis. tiga opsi, atau teks yang bukan "Benar"/"Salah").
    if (tipe === 'benar_salah') {
      const tambah = db.prepare(
        'INSERT INTO opsi (slide_id, urutan, teks, benar) VALUES (?, ?, ?, ?)',
      );
      tambah.run(slideId, 0, 'Benar', 1);
      tambah.run(slideId, 1, 'Salah', 0);
    }

    db.prepare(`UPDATE presentasi SET updated_at = datetime('now') WHERE id = ?`).run(
      presentasiId,
    );

    return slideId;
  });

  return { id: buatSlideDanOpsiBawaan() };
}

export interface DataUbahOpsi {
  teks: string;
  benar?: boolean;
}

export interface DataUbahSlide {
  pertanyaan?: string;
  konfig?: KonfigSlide;
  opsi?: DataUbahOpsi[];
}

/**
 * Validasi per tipe. Ini satu-satunya tempat aturan "tipe X wajib punya opsi Y"
 * ditegakkan di sisi server — jangan percaya validasi Vue saja, karena endpoint
 * ini juga jadi sasaran kalau suatu saat ada klien lain (mis. import massal).
 */
function validasiOpsiUntukTipe(tipe: TipeSlide, opsi: DataUbahOpsi[] | undefined): void {
  // benar_salah punya aturan sendiri: teks-nya TETAP "Benar"/"Salah", tapi mana
  // yang benar untuk pernyataan spesifik guru itu HARUS bisa dipilih — bukan
  // selalu "Benar" begitu saja (pernyataan bisa saja memang salah).
  if (tipe === 'benar_salah') {
    if (opsi === undefined) return; // pertanyaan/konfig diubah tanpa menyentuh opsi — sah
    const teksNya = opsi.map((o) => o.teks.trim());
    const cocok =
      opsi.length === 2 &&
      teksNya.includes('Benar') &&
      teksNya.includes('Salah') &&
      opsi.filter((o) => o.benar).length === 1;
    if (!cocok) {
      throw galatValidasi('Opsi benar_salah harus tetap "Benar" dan "Salah", dengan salah satu ditandai benar.');
    }
    return;
  }

  const butuhOpsi: readonly TipeSlide[] = [
    'pilihan_ganda',
    'kuis',
    'peringkat',
    'puzzle',
  ];
  if (!butuhOpsi.includes(tipe)) return;

  if (!opsi || opsi.length < 2) {
    throw galatValidasi('Tipe slide ini butuh minimal 2 opsi.');
  }
  for (const o of opsi) {
    if (o.teks.trim() === '') throw galatValidasi('Teks opsi tidak boleh kosong.');
    if (o.teks.length > BATAS.opsiTeks) {
      throw galatValidasi(`Teks opsi maksimal ${BATAS.opsiTeks} karakter.`);
    }
  }

  // Hanya `kuis` (keluarga Kahoot, berpoin) yang butuh jawaban benar.
  // `pilihan_ganda` adalah jajak pendapat Menti — sengaja tanpa jawaban benar.
  if (tipe === 'kuis' && !opsi.some((o) => o.benar)) {
    throw galatValidasi('Tandai minimal satu opsi sebagai jawaban benar.');
  }
}

export function ubahSlide(slideId: number, guruId: number, data: DataUbahSlide): void {
  const baris = slideMilik(slideId, guruId);
  const tipe = baris.tipe as TipeSlide;
  const db = getDb();

  if (data.pertanyaan !== undefined && data.pertanyaan.length > BATAS.pertanyaan) {
    throw galatValidasi(`Pertanyaan maksimal ${BATAS.pertanyaan} karakter.`);
  }

  if (data.opsi !== undefined) validasiOpsiUntukTipe(tipe, data.opsi);

  const terapkan = db.transaction(() => {
    if (data.pertanyaan !== undefined || data.konfig !== undefined) {
      const konfigGabungan = data.konfig
        ? { ...(JSON.parse(baris.konfig_json) as KonfigSlide), ...data.konfig }
        : undefined;

      db.prepare(
        `UPDATE slide
         SET pertanyaan = COALESCE(?, pertanyaan), konfig_json = COALESCE(?, konfig_json)
         WHERE id = ?`,
      ).run(data.pertanyaan ?? null, konfigGabungan ? JSON.stringify(konfigGabungan) : null, slideId);
    }

    // benar_salah pun boleh lewat sini sekarang — validasiOpsiUntukTipe di atas
    // sudah memastikan teksnya tetap "Benar"/"Salah", cuma togel mana yang benar.
    if (data.opsi !== undefined) {
      db.prepare('DELETE FROM opsi WHERE slide_id = ?').run(slideId);
      const tambah = db.prepare(
        'INSERT INTO opsi (slide_id, urutan, teks, benar) VALUES (?, ?, ?, ?)',
      );
      data.opsi.forEach((o, i) => {
        tambah.run(slideId, i, o.teks.trim(), o.benar ? 1 : 0);
      });
    }

    db.prepare(`UPDATE presentasi SET updated_at = datetime('now') WHERE id = ?`).run(
      baris.presentasi_id,
    );
  });

  terapkan();
}

export function hapusSlide(slideId: number, guruId: number): void {
  const baris = slideMilik(slideId, guruId);
  const db = getDb();

  const terapkan = db.transaction(() => {
    db.prepare('DELETE FROM slide WHERE id = ?').run(slideId);
    // Rapatkan kembali nomor urutan supaya tidak ada celah (0,1,3,4 → 0,1,2,3).
    const sisa = db
      .prepare('SELECT id FROM slide WHERE presentasi_id = ? ORDER BY urutan')
      .all(baris.presentasi_id) as { id: number }[];
    const ubahUrutan = db.prepare('UPDATE slide SET urutan = ? WHERE id = ?');
    sisa.forEach((s, i) => ubahUrutan.run(i, s.id));

    db.prepare(`UPDATE presentasi SET updated_at = datetime('now') WHERE id = ?`).run(
      baris.presentasi_id,
    );
  });

  terapkan();
}

/** Susun ulang urutan slide sesuai array id yang dikirim dari drag-and-drop Vue. */
export function urutkanSlide(presentasiId: number, guruId: number, idUrutan: number[]): void {
  ambilPresentasiMilik(presentasiId, guruId);
  const db = getDb();

  const milik = db
    .prepare('SELECT id FROM slide WHERE presentasi_id = ?')
    .all(presentasiId) as { id: number }[];
  const idValid = new Set(milik.map((s) => s.id));

  if (idUrutan.length !== idValid.size || !idUrutan.every((id) => idValid.has(id))) {
    throw galatValidasi('Daftar urutan tidak cocok dengan slide yang ada.');
  }

  const terapkan = db.transaction(() => {
    const ubah = db.prepare('UPDATE slide SET urutan = ? WHERE id = ?');
    idUrutan.forEach((id, i) => ubah.run(i, id));
    db.prepare(`UPDATE presentasi SET updated_at = datetime('now') WHERE id = ?`).run(
      presentasiId,
    );
  });
  terapkan();
}

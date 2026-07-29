import { getDb } from '../db/index.js';
import { galatTidakDitemukan } from '../galat.js';

/**
 * Rekap hasil sesi — dibaca LANGSUNG dari SQLite, tidak menyentuh Redis sama
 * sekali. Ini sengaja: rekap harus tetap bisa dibuka berhari-hari setelah
 * sesi selesai dan Redis-nya sudah lama kedaluwarsa/di-flush.
 */

interface BarisSesiInfo {
  id: number;
  guru_id: number;
  kode: string;
  status: string;
  mulai_at: string | null;
  selesai_at: string | null;
  judul: string;
}

function sesiUntukGuru(sesiId: number, guruId: number): BarisSesiInfo {
  const b = getDb()
    .prepare(
      `SELECT s.id, s.guru_id, s.kode, s.status, s.mulai_at, s.selesai_at, p.judul
       FROM sesi s JOIN presentasi p ON p.id = s.presentasi_id
       WHERE s.id = ?`,
    )
    .get(sesiId) as BarisSesiInfo | undefined;
  if (!b || b.guru_id !== guruId) throw galatTidakDitemukan('Sesi tidak ditemukan.');
  return b;
}

export interface BarisLeaderboardRekap {
  nama: string;
  skor: number;
  peringkat: number;
}

export interface RingkasanSlideRekap {
  slideId: number;
  tipe: string;
  pertanyaan: string;
  jumlahJawaban: number;
  jumlahBenar: number | null; // null untuk tipe Menti (tidak relevan)
}

export interface HasilSesi {
  judul: string;
  kode: string;
  status: string;
  mulaiAt: string | null;
  selesaiAt: string | null;
  jumlahPeserta: number;
  leaderboard: BarisLeaderboardRekap[];
  slide: RingkasanSlideRekap[];
}

export function hasilSesi(sesiId: number, guruId: number): HasilSesi {
  const info = sesiUntukGuru(sesiId, guruId);
  const db = getDb();

  const jumlahPeserta = (
    db.prepare('SELECT COUNT(*) AS n FROM peserta WHERE sesi_id = ?').get(sesiId) as { n: number }
  ).n;

  const leaderboard = db
    .prepare('SELECT nama, skor FROM peserta WHERE sesi_id = ? ORDER BY skor DESC, id ASC')
    .all(sesiId) as { nama: string; skor: number }[];

  // `j.sesi_id = ?` WAJIB ada di kedua subquery. Tanpa itu, presentasi yang
  // dipakai ulang untuk kelas berikutnya akan menampilkan gabungan jawaban dari
  // SEMUA sesi — persis kasus yang paling sering terjadi (satu materi, dipakai
  // di beberapa jam pelajaran). `disembunyikan = 0` juga difilter supaya angka
  // di rekap cocok dengan apa yang benar-benar tampil di layar.
  const slideRingkas = db
    .prepare(
      `SELECT sl.id AS slide_id, sl.tipe, sl.pertanyaan,
              (SELECT COUNT(*) FROM jawaban j
                WHERE j.slide_id = sl.id AND j.sesi_id = ? AND j.disembunyikan = 0) AS jumlah_jawaban,
              (SELECT COUNT(*) FROM jawaban j
                WHERE j.slide_id = sl.id AND j.sesi_id = ? AND j.disembunyikan = 0 AND j.benar = 1) AS jumlah_benar
       FROM slide sl
       WHERE sl.presentasi_id = (SELECT presentasi_id FROM sesi WHERE id = ?)
       ORDER BY sl.urutan`,
    )
    .all(sesiId, sesiId, sesiId) as {
    slide_id: number;
    tipe: string;
    pertanyaan: string;
    jumlah_jawaban: number;
    jumlah_benar: number;
  }[];

  const TIPE_BERPOIN = new Set(['kuis', 'benar_salah', 'ketik_jawaban', 'puzzle', 'pin_jawaban']);

  return {
    judul: info.judul,
    kode: info.kode,
    status: info.status,
    mulaiAt: info.mulai_at,
    selesaiAt: info.selesai_at,
    jumlahPeserta,
    leaderboard: leaderboard.map((b, i) => ({ nama: b.nama, skor: b.skor, peringkat: i + 1 })),
    slide: slideRingkas.map((s) => ({
      slideId: s.slide_id,
      tipe: s.tipe,
      pertanyaan: s.pertanyaan,
      jumlahJawaban: s.jumlah_jawaban,
      jumlahBenar: TIPE_BERPOIN.has(s.tipe) ? s.jumlah_benar : null,
    })),
  };
}

export interface RingkasSesiRiwayat {
  sesiId: number;
  kode: string;
  status: string;
  mulaiAt: string | null;
  selesaiAt: string | null;
  jumlahPeserta: number;
  jumlahJawaban: number;
}

/**
 * Riwayat semua sesi milik satu presentasi — inilah pintu masuk guru untuk
 * mengunduh data kelas-kelas sebelumnya. Satu presentasi lazim dipakai berkali
 * -kali (jam ke-1 kelas A, jam ke-3 kelas B), dan tiap sesi punya kode serta
 * datanya sendiri yang tidak boleh tercampur.
 *
 * Hitungan peserta & jawaban diambil lewat LEFT JOIN + GROUP BY dalam SATU
 * query, bukan query per sesi (N+1).
 */
export function daftarSesiPresentasi(presentasiId: number, guruId: number): RingkasSesiRiwayat[] {
  const db = getDb();
  const milik = db
    .prepare('SELECT 1 FROM presentasi WHERE id = ? AND guru_id = ?')
    .get(presentasiId, guruId);
  if (!milik) throw galatTidakDitemukan('Presentasi tidak ditemukan.');

  const baris = db
    .prepare(
      `SELECT s.id, s.kode, s.status, s.mulai_at, s.selesai_at,
              (SELECT COUNT(*) FROM peserta p WHERE p.sesi_id = s.id) AS jumlah_peserta,
              (SELECT COUNT(*) FROM jawaban j WHERE j.sesi_id = s.id) AS jumlah_jawaban
       FROM sesi s
       WHERE s.presentasi_id = ?
       ORDER BY s.id DESC`,
    )
    .all(presentasiId) as {
    id: number;
    kode: string;
    status: string;
    mulai_at: string | null;
    selesai_at: string | null;
    jumlah_peserta: number;
    jumlah_jawaban: number;
  }[];

  return baris.map((b) => ({
    sesiId: b.id,
    kode: b.kode,
    status: b.status,
    mulaiAt: b.mulai_at,
    selesaiAt: b.selesai_at,
    jumlahPeserta: b.jumlah_peserta,
    jumlahJawaban: b.jumlah_jawaban,
  }));
}

interface BarisJawabanCsv {
  peserta_nama: string;
  slide_urutan: number;
  slide_tipe: string;
  pertanyaan: string;
  nilai_teks: string | null;
  nilai_angka: number | null;
  opsi_teks: string | null;
  ketepatan: number;
  poin: number;
  waktu_ms: number | null;
  created_at: string;
}

/** Satu baris CSV per jawaban — bulk JOIN, bukan query per baris. */
export function csvHasilSesi(sesiId: number, guruId: number): string {
  sesiUntukGuru(sesiId, guruId); // 404 kalau bukan pemilik

  const baris = getDb()
    .prepare(
      `SELECT p.nama AS peserta_nama, sl.urutan AS slide_urutan, sl.tipe AS slide_tipe,
              sl.pertanyaan, j.nilai_teks, j.nilai_angka, o.teks AS opsi_teks,
              j.ketepatan, j.poin, j.waktu_ms, j.created_at
       FROM jawaban j
       JOIN peserta p ON p.id = j.peserta_id
       JOIN slide sl ON sl.id = j.slide_id
       LEFT JOIN opsi o ON o.id = j.opsi_id
       WHERE j.sesi_id = ?
       ORDER BY sl.urutan, p.nama`,
    )
    .all(sesiId) as BarisJawabanCsv[];

  const kolom = [
    'Peserta',
    'Nomor Slide',
    'Tipe',
    'Pertanyaan',
    'Jawaban',
    'Ketepatan',
    'Poin',
    'Waktu (ms)',
    'Waktu Kirim',
  ];

  function csvAman(nilai: unknown): string {
    const s = String(nilai ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const baris_ = baris.map((b) => {
    const jawabanTampil = b.opsi_teks ?? b.nilai_teks ?? b.nilai_angka?.toString() ?? '';
    return [
      b.peserta_nama,
      b.slide_urutan + 1,
      b.slide_tipe,
      b.pertanyaan,
      jawabanTampil,
      b.ketepatan,
      b.poin,
      b.waktu_ms ?? '',
      b.created_at,
    ]
      .map(csvAman)
      .join(',');
  });

  return [kolom.join(','), ...baris_].join('\n');
}

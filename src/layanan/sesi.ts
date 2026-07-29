import { randomInt, randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { galatSesiDitutup, galatTidakDitemukan, galatValidasi } from '../galat.js';
import { log } from '../log.js';
import { redisUmum } from '../redis/client.js';
import { kunci } from '../redis/kunci.js';
import { rehidrasiAgregatJikaPerlu } from '../redis/agregat.js';
import { buatKode } from '../util/kode.js';
import { BATAS, TTL_SESI_DETIK } from '../../shared/konstanta.js';
import type {
  BarisPeringkat,
  KonfigSlide,
  KondisiSesi,
  Opsi,
  Slide,
  StatusSesi,
  TipeSlide,
} from '../../shared/tipe.js';

/**
 * Siklus hidup sesi live: mulai → peserta join → sinkron slide → selesai.
 *
 * Prinsip inti (lihat CONTEXT percakapan perencanaan): Redis adalah tingkat live
 * yang BOLEH hilang kapan saja; SQLite adalah arsip permanen. `pastikanStateAda`
 * adalah satu-satunya tempat yang menulis ulang Redis dari SQLite, dan dipanggil
 * baik saat sesi pertama kali dibuka maupun saat pemulihan setelah Redis flush —
 * dua kasus itu sengaja memakai jalur kode yang sama, bukan dua fungsi terpisah.
 */

interface BarisSesi {
  id: number;
  presentasi_id: number;
  guru_id: number;
  kode: string;
  status: StatusSesi;
  slide_aktif_id: number | null;
  izinkan_join_telat: number;
}

interface BarisSlideMentah {
  id: number;
  tipe: string;
  pertanyaan: string;
  konfig_json: string;
}

interface BarisOpsiMentah {
  id: number;
  slide_id: number;
  urutan: number;
  teks: string;
  benar: number;
}

function ambilSesi(sesiId: number): BarisSesi {
  const baris = getDb().prepare('SELECT * FROM sesi WHERE id = ?').get(sesiId) as
    | BarisSesi
    | undefined;
  if (!baris) throw galatTidakDitemukan('Sesi tidak ditemukan.');
  return baris;
}

/* ────────────────────────────── Mulai & selesaikan ────────────────────────────── */

export function mulaiSesi(presentasiId: number, guruId: number): { sesiId: number; kode: string } {
  const db = getDb();

  const presentasi = db
    .prepare('SELECT id FROM presentasi WHERE id = ? AND guru_id = ?')
    .get(presentasiId, guruId);
  if (!presentasi) throw galatTidakDitemukan('Presentasi tidak ditemukan.');

  const slidePertama = db
    .prepare('SELECT id FROM slide WHERE presentasi_id = ? ORDER BY urutan LIMIT 1')
    .get(presentasiId) as { id: number } | undefined;
  if (!slidePertama) {
    throw galatValidasi('Tambahkan minimal satu slide sebelum memulai sesi.');
  }

  // Percobaan di level aplikasi untuk menghindari bentrok kode secara umum;
  // unique index parsial di skema (`idx_sesi_kode_aktif`) tetap jadi penjamin
  // akhir kalau dua request nyaris bersamaan lolos dari pengecekan ini.
  let kodeTerpilih: string | null = null;
  for (let i = 0; i < 10; i++) {
    const kandidat = buatKode();
    const bentrok = db
      .prepare(`SELECT 1 FROM sesi WHERE kode = ? AND status <> 'selesai'`)
      .get(kandidat);
    if (!bentrok) {
      kodeTerpilih = kandidat;
      break;
    }
  }
  if (!kodeTerpilih) throw new Error('Gagal membuat kode sesi unik setelah 10 percobaan.');

  // Status AWAL sengaja 'menunggu' dengan slide_aktif_id NULL, BUKAN langsung
  // membuka slide pertama — ini yang membuat lobby (kode + QR + daftar peserta
  // yang sudah join) di layar presenter benar-benar berfungsi. Guru baru
  // memicu transisi ke 'berjalan' lewat aksi eksplisit (pindahSlide) saat
  // menekan "Mulai Presentasi".
  const info = db
    .prepare(
      `INSERT INTO sesi (presentasi_id, guru_id, kode, status, slide_aktif_id, mulai_at)
       VALUES (?, ?, ?, 'menunggu', NULL, datetime('now'))`,
    )
    .run(presentasiId, guruId, kodeTerpilih);

  const sesiId = Number(info.lastInsertRowid);
  log.info({ sesiId, kode: kodeTerpilih, presentasiId }, 'Sesi dimulai');
  return { sesiId, kode: kodeTerpilih };
}

export async function selesaikanSesi(sesiId: number, guruId: number): Promise<void> {
  const baris = ambilSesi(sesiId);
  if (baris.guru_id !== guruId) throw galatTidakDitemukan('Sesi tidak ditemukan.');

  getDb()
    .prepare(`UPDATE sesi SET status = 'selesai', selesai_at = datetime('now') WHERE id = ?`)
    .run(sesiId);

  // Kode dilepas segera supaya bisa dipakai ulang tanpa menunggu TTL Redis habis;
  // sisa key (agregat, peserta) dibiarkan kedaluwarsa sendiri — tidak mendesak,
  // dan menghapusnya satu-satu di sini cuma menambah latensi ke aksi guru.
  await redisUmum().del(kunci.kodeSesi(baris.kode));
  log.info({ sesiId }, 'Sesi diselesaikan');
}

/* ─────────────────────────────── Slide untuk pengiriman ─────────────────────────────── */

/**
 * Bentuk slide yang AMAN dikirim lewat socket — field `benar` pada opsi selalu
 * dihapus, dan untuk `puzzle` urutan opsi diacak (kalau tidak, urutan asli di
 * database = kunci jawaban akan bocor lewat payload yang bisa dibaca siapa pun
 * lewat DevTools). Jangan pernah pakai fungsi `detailPresentasi` (editor guru)
 * untuk sesi live — itu sengaja menyertakan `benar` untuk kebutuhan mengedit.
 */
function slideUntukPengiriman(slideId: number): Slide {
  const db = getDb();
  const s = db.prepare('SELECT * FROM slide WHERE id = ?').get(slideId) as
    | BarisSlideMentah
    | undefined;
  if (!s) throw galatTidakDitemukan('Slide tidak ditemukan.');

  const barisOpsi = db
    .prepare('SELECT * FROM opsi WHERE slide_id = ? ORDER BY urutan')
    .all(slideId) as BarisOpsiMentah[];

  let opsi: Opsi[] = barisOpsi.map((o) => ({ id: o.id, urutan: o.urutan, teks: o.teks }));

  if (s.tipe === 'puzzle') {
    opsi = kocokFisherYates(opsi).map((o, i) => ({ ...o, urutan: i }));
  }

  return {
    id: s.id,
    urutan: 0, // tidak relevan di luar konteks editor; slide dikirim satu per satu
    tipe: s.tipe as TipeSlide,
    pertanyaan: s.pertanyaan,
    konfig: JSON.parse(s.konfig_json) as KonfigSlide,
    opsi,
  };
}

function kocokFisherYates<T>(arr: T[]): T[] {
  const salin = [...arr];
  for (let i = salin.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = salin[i]!;
    salin[i] = salin[j]!;
    salin[j] = tmp;
  }
  return salin;
}

/* ─────────────────────────────── Rehidrasi state Redis ─────────────────────────────── */

interface HashSesi {
  status?: string;
  slideAktifId?: string;
  slideDibuka?: string;
  mulaiSlideAt?: string;
}

/**
 * Pastikan state Redis untuk sesi ini ada. Idempoten dan murah dipanggil
 * berulang: kalau semua sudah ada, hanya melakukan satu EXISTS + satu HLEN.
 * Dipanggil dari `kondisiSesi` (lazy, di jalur baca) dan dari handler socket
 * `presenter:buka` (eksplisit, saat guru pertama kali membuka layar).
 */
async function pastikanStateAda(baris: BarisSesi): Promise<void> {
  const redis = redisUmum();
  const kunciSesi = kunci.sesi(baris.id);

  const ada = await redis.exists(kunciSesi);
  if (!ada) {
    await redis.hset(kunciSesi, {
      status: baris.status,
      slideAktifId: String(baris.slide_aktif_id ?? ''),
      slideDibuka: '1',
      mulaiSlideAt: String(Date.now()),
    });
    await redis.expire(kunciSesi, TTL_SESI_DETIK);
    log.info({ sesiId: baris.id }, 'State sesi diinisialisasi/direhidrasi di Redis');
  }

  await redis.set(kunci.kodeSesi(baris.kode), String(baris.id), 'EX', TTL_SESI_DETIK);

  const kunciPeserta = kunci.sesiPeserta(baris.id);
  const jumlahPeserta = await redis.hlen(kunciPeserta);
  if (jumlahPeserta === 0) {
    const db = getDb();
    const barisPeserta = db
      .prepare('SELECT id, token, nama, skor FROM peserta WHERE sesi_id = ?')
      .all(baris.id) as { id: number; token: string; nama: string; skor: number }[];

    if (barisPeserta.length > 0) {
      const fieldValue: Record<string, string> = {};
      const entriSkor: (string | number)[] = [];
      for (const p of barisPeserta) {
        fieldValue[p.token] = JSON.stringify({ id: p.id, nama: p.nama, skor: p.skor });
        entriSkor.push(p.skor, String(p.id));
      }
      await redis.hset(kunciPeserta, fieldValue);
      await redis.expire(kunciPeserta, TTL_SESI_DETIK);
      if (entriSkor.length > 0) {
        await redis.zadd(kunci.skor(baris.id), ...entriSkor);
        await redis.expire(kunci.skor(baris.id), TTL_SESI_DETIK);
      }
      log.info({ sesiId: baris.id, jumlah: barisPeserta.length }, 'Peserta & skor direhidrasi dari SQLite');
    }
  }
}

/**
 * Bentuk `KondisiSesi` yang dikirim ke peserta maupun presenter. `token`
 * opsional — kalau diisi, `sudahJawab` dihitung untuk peserta itu; presenter
 * tidak butuh ini jadi cukup panggil tanpa token.
 */
export async function kondisiSesi(sesiId: number, token?: string): Promise<KondisiSesi> {
  const baris = ambilSesi(sesiId);
  const db = getDb();

  const jumlahSlide = (
    db
      .prepare('SELECT COUNT(*) AS n FROM slide WHERE presentasi_id = ?')
      .get(baris.presentasi_id) as { n: number }
  ).n;

  if (baris.status === 'selesai') {
    return {
      sesiId,
      kode: baris.kode,
      status: 'selesai',
      slide: null,
      dibuka: false,
      mulaiSlideAt: null,
      sudahJawab: false,
      jumlahSlide,
    };
  }

  await pastikanStateAda(baris);

  const redis = redisUmum();
  const data = (await redis.hgetall(kunci.sesi(sesiId))) as HashSesi;
  const slideAktifId = data.slideAktifId ? Number(data.slideAktifId) : null;
  const slide = slideAktifId ? slideUntukPengiriman(slideAktifId) : null;

  // Rehidrasi lazy: hanya slide yang benar-benar sedang aktif yang dipulihkan,
  // bukan seluruh slide dalam presentasi — dipanggil di sini supaya berlaku
  // otomatis lewat jalur mana pun yang membaca kondisi (join, buka, rejoin).
  if (slide) {
    await rehidrasiAgregatJikaPerlu(sesiId, slide.id, slide.tipe, slide.konfig);
  }

  let sudahJawab = false;
  if (token && slideAktifId) {
    sudahJawab =
      (await redis.sismember(kunci.sesiJawab(sesiId, slideAktifId), token)) === 1;
  }

  return {
    sesiId,
    kode: baris.kode,
    status: (data.status as StatusSesi) ?? baris.status,
    slide,
    dibuka: data.slideDibuka === '1',
    mulaiSlideAt: data.mulaiSlideAt ? Number(data.mulaiSlideAt) : null,
    sudahJawab,
    jumlahSlide,
  };
}

export async function cariSesiIdDariKode(kodeMentah: string): Promise<number | null> {
  const redis = redisUmum();
  const dariRedis = await redis.get(kunci.kodeSesi(kodeMentah));
  if (dariRedis) return Number(dariRedis);

  // Redis kosong (baru flush) — jatuh balik ke SQLite, lalu tulis lagi ke Redis
  // supaya lookup berikutnya tidak perlu ke database.
  const baris = getDb()
    .prepare(`SELECT id FROM sesi WHERE kode = ? AND status <> 'selesai'`)
    .get(kodeMentah) as { id: number } | undefined;
  if (!baris) return null;

  await redis.set(kunci.kodeSesi(kodeMentah), String(baris.id), 'EX', TTL_SESI_DETIK);
  return baris.id;
}

/** Untuk guru: cari sesi berjalan milik presentasi tertentu (dipakai layar presenter). */
export function sesiAktifUntukPresentasi(presentasiId: number, guruId: number): { sesiId: number; kode: string } | null {
  const baris = getDb()
    .prepare(
      `SELECT id, kode FROM sesi
       WHERE presentasi_id = ? AND guru_id = ? AND status <> 'selesai'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(presentasiId, guruId) as { id: number; kode: string } | undefined;
  return baris ? { sesiId: baris.id, kode: baris.kode } : null;
}

export function sesiUntukGuru(sesiId: number, guruId: number): BarisSesi {
  const baris = ambilSesi(sesiId);
  if (baris.guru_id !== guruId) throw galatTidakDitemukan('Sesi tidak ditemukan.');
  return baris;
}

/* ─────────────────────────────────── Pindah slide ─────────────────────────────────── */

/**
 * Pindah slide aktif. Mengembalikan `dibuka` — false berarti slide ini dibuka
 * kembali dalam keadaan TERKUNCI karena sudah pernah dijawab.
 *
 * Slide yang sudah punya jawaban (mis. guru menekan "Sebelumnya" untuk membahas
 * ulang soal yang tadi) sengaja TIDAK dibuka ulang dan timernya TIDAK di-restart.
 * Kalau di-restart, peserta yang sudah menjawab akan melihat hitung mundur
 * berjalan lagi padahal mereka tidak bisa menjawab lagi (ditolak anti-double-vote),
 * dan hasil yang tadi sudah terbuka jadi hilang dari layar. Untuk benar-benar
 * mengulang soal dari nol, jalurnya adalah `resetSlideJawaban` (tombol Reset).
 */
export async function pindahSlide(
  sesiId: number,
  guruId: number,
  slideId: number,
): Promise<{ dibuka: boolean }> {
  const baris = sesiUntukGuru(sesiId, guruId);
  if (baris.status === 'selesai') throw galatSesiDitutup('Sesi ini sudah selesai.');

  const db = getDb();
  const slideAda = db
    .prepare('SELECT id FROM slide WHERE id = ? AND presentasi_id = ?')
    .get(slideId, baris.presentasi_id);
  if (!slideAda) throw galatTidakDitemukan('Slide tidak ditemukan di presentasi ini.');

  const sudahAdaJawaban =
    (
      db
        .prepare('SELECT COUNT(*) AS n FROM jawaban WHERE sesi_id = ? AND slide_id = ?')
        .get(sesiId, slideId) as { n: number }
    ).n > 0;

  const redis = redisUmum();
  const bidang: Record<string, string> = {
    slideAktifId: String(slideId),
    slideDibuka: sudahAdaJawaban ? '0' : '1',
    status: 'berjalan',
  };
  // `mulaiSlideAt` hanya di-set ulang untuk slide yang benar-benar baru dibuka —
  // menyentuhnya pada slide yang sudah dijawab akan membuat timer di HP peserta
  // menghitung mundur lagi dari awal.
  if (!sudahAdaJawaban) bidang.mulaiSlideAt = String(Date.now());

  await redis.hset(kunci.sesi(sesiId), bidang);
  await redis.expire(kunci.sesi(sesiId), TTL_SESI_DETIK);

  // Idempoten: kalau sesi masih 'menunggu' (lobby, belum ada slide aktif),
  // baris ini yang memindahkannya ke 'berjalan'. Aksi guru yang sama
  // (memindahkan slide) dipakai baik untuk "Mulai Presentasi" pertama kali
  // maupun navigasi next/prev sesudahnya — tidak ada jalur kode terpisah.
  db.prepare(`UPDATE sesi SET slide_aktif_id = ?, status = 'berjalan' WHERE id = ?`).run(slideId, sesiId);

  return { dibuka: !sudahAdaJawaban };
}

export async function kunciSlide(sesiId: number, guruId: number, dibuka: boolean): Promise<void> {
  sesiUntukGuru(sesiId, guruId);
  await redisUmum().hset(kunci.sesi(sesiId), { slideDibuka: dibuka ? '1' : '0' });
}

/**
 * Sembunyikan satu jawaban dari layar (moderasi). Wajib ada karena peserta
 * anonim: kalau ada yang menulis hal tidak pantas di slide open-ended, guru
 * harus bisa menghapusnya dari proyektor seketika.
 *
 * Barisnya TIDAK dihapus, hanya ditandai `disembunyikan = 1` — jejaknya tetap
 * ada di rekap/CSV untuk ditindaklanjuti guru. Agregat Redis dibuang supaya
 * dibangun ulang dari SQLite tanpa baris itu (rehidrasi sudah memfilter
 * `disembunyikan = 0`).
 *
 * Mengembalikan `slideId` jawaban tersebut supaya pemanggil tahu slide mana
 * yang perlu disiarkan ulang.
 */
export async function sembunyikanJawaban(
  sesiId: number,
  guruId: number,
  jawabanId: number,
): Promise<{ slideId: number }> {
  sesiUntukGuru(sesiId, guruId);

  const db = getDb();
  const baris = db
    .prepare('SELECT slide_id FROM jawaban WHERE id = ? AND sesi_id = ?')
    .get(jawabanId, sesiId) as { slide_id: number } | undefined;
  if (!baris) throw galatTidakDitemukan('Jawaban tidak ditemukan di sesi ini.');

  db.prepare('UPDATE jawaban SET disembunyikan = 1 WHERE id = ?').run(jawabanId);
  await redisUmum().del(kunci.agregat(sesiId, baris.slide_id));

  // Bangun ulang SEKARANG juga, bukan menunggu jalur baca berikutnya:
  // `siarkanSekarang` membaca agregat langsung dari Redis tanpa rehidrasi, jadi
  // kalau key-nya dibiarkan kosong layar presenter justru jadi kosong total
  // (bukan sekadar kehilangan satu kartu yang disembunyikan).
  const slide = db
    .prepare('SELECT tipe, konfig_json FROM slide WHERE id = ?')
    .get(baris.slide_id) as { tipe: string; konfig_json: string };
  await rehidrasiAgregatJikaPerlu(
    sesiId,
    baris.slide_id,
    slide.tipe as TipeSlide,
    JSON.parse(slide.konfig_json) as KonfigSlide,
  );

  log.info({ sesiId, jawabanId }, 'Jawaban disembunyikan oleh guru');
  return { slideId: baris.slide_id };
}

/**
 * Hapus semua jawaban satu slide dalam sesi ini supaya bisa ditanyakan ulang
 * dari nol — guru sering perlu ini untuk mengulang pertanyaan yang sama ke
 * kelompok/kelas berikutnya tanpa membuat sesi (kode) baru.
 *
 * Poin Kahoot yang sudah masuk skor peserta DIBALIK dulu lewat `tambahSkorPeserta`
 * dengan nilai negatif — kalau tidak, leaderboard akan menyisakan poin dari
 * jawaban yang justru sedang dihapus.
 */
export async function resetSlideJawaban(sesiId: number, guruId: number, slideId: number): Promise<void> {
  const baris = sesiUntukGuru(sesiId, guruId);
  if (baris.status === 'selesai') throw galatSesiDitutup('Sesi ini sudah selesai.');

  const db = getDb();
  const slideAda = db
    .prepare('SELECT id FROM slide WHERE id = ? AND presentasi_id = ?')
    .get(slideId, baris.presentasi_id);
  if (!slideAda) throw galatTidakDitemukan('Slide tidak ditemukan di presentasi ini.');

  const jumlahPoinPerPeserta = db
    .prepare(
      `SELECT peserta_id, SUM(poin) AS total FROM jawaban
       WHERE sesi_id = ? AND slide_id = ? AND poin <> 0 GROUP BY peserta_id`,
    )
    .all(sesiId, slideId) as { peserta_id: number; total: number }[];
  for (const p of jumlahPoinPerPeserta) {
    await tambahSkorPeserta(sesiId, p.peserta_id, -p.total);
  }

  db.prepare('DELETE FROM jawaban WHERE sesi_id = ? AND slide_id = ?').run(sesiId, slideId);

  const redis = redisUmum();
  await redis.del(kunci.agregat(sesiId, slideId));
  await redis.del(kunci.sesiJawab(sesiId, slideId));

  // Kalau slide ini yang sedang aktif, buka kembali & mulai ulang timer supaya
  // skor kecepatan Kahoot tetap adil untuk babak jawab yang baru.
  const hashSesi = await redis.hgetall(kunci.sesi(sesiId));
  if (Number(hashSesi.slideAktifId) === slideId) {
    await redis.hset(kunci.sesi(sesiId), { slideDibuka: '1', mulaiSlideAt: String(Date.now()) });
    await redis.expire(kunci.sesi(sesiId), TTL_SESI_DETIK);
  }

  log.info({ sesiId, slideId }, 'Jawaban slide direset');
}

/**
 * Kosongkan SELURUH sesi: semua jawaban di semua slide, seluruh peserta, dan
 * skornya. Dipakai guru yang ingin memakai ulang sesi (kode) yang sama untuk
 * kelas berikutnya di jam berbeda, tanpa data kelas sebelumnya ikut tercampur.
 *
 * BEDA dengan `resetSlideJawaban` (satu slide saja, peserta tetap) — yang ini
 * juga menghapus daftar peserta, karena kelas berikutnya adalah orang-orang
 * yang benar-benar berbeda. Kalau data kelas lama masih dibutuhkan, guru harus
 * mengunduh CSV-nya LEBIH DULU; ini ditegaskan di dialog konfirmasi UI.
 */
export async function resetSeluruhSesi(sesiId: number, guruId: number): Promise<{ kode: string }> {
  const baris = sesiUntukGuru(sesiId, guruId);

  const db = getDb();
  const slideIds = db
    .prepare('SELECT id FROM slide WHERE presentasi_id = ?')
    .all(baris.presentasi_id) as { id: number }[];

  // Sesi yang sudah 'selesai' melepas kodenya untuk dipakai ulang (lihat
  // `idx_sesi_kode_aktif`, unique hanya selama status <> 'selesai'). Jadi saat
  // menghidupkannya kembali, kode lamanya bisa saja sudah dipegang sesi lain —
  // kalau dipaksakan, UPDATE-nya gagal karena melanggar unique index. Cek dulu,
  // dan terbitkan kode baru bila memang sudah bentrok.
  let kodeDipakai = baris.kode;
  const bentrok = db
    .prepare(`SELECT 1 FROM sesi WHERE kode = ? AND status <> 'selesai' AND id <> ?`)
    .get(baris.kode, sesiId);
  if (bentrok) {
    for (let i = 0; i < 10; i++) {
      const kandidat = buatKode();
      if (!db.prepare(`SELECT 1 FROM sesi WHERE kode = ? AND status <> 'selesai'`).get(kandidat)) {
        kodeDipakai = kandidat;
        break;
      }
    }
    if (kodeDipakai === baris.kode) throw new Error('Gagal membuat kode sesi unik setelah 10 percobaan.');
  }

  // Satu transaksi: kalau salah satu DELETE gagal, jangan sampai sesi tertinggal
  // dalam keadaan separuh terhapus (peserta hilang tapi jawabannya masih ada).
  db.transaction(() => {
    db.prepare('DELETE FROM jawaban WHERE sesi_id = ?').run(sesiId);
    db.prepare('DELETE FROM peserta WHERE sesi_id = ?').run(sesiId);
    db.prepare(
      `UPDATE sesi SET status = 'menunggu', slide_aktif_id = NULL, kode = ?,
                       selesai_at = NULL, mulai_at = datetime('now')
       WHERE id = ?`,
    ).run(kodeDipakai, sesiId);
  })();

  const redis = redisUmum();
  await redis.del(
    kunci.kodeSesi(baris.kode),
    kunci.sesi(sesiId),
    kunci.sesiPeserta(sesiId),
    kunci.sesiHadir(sesiId),
    kunci.skor(sesiId),
    ...slideIds.map((s) => kunci.agregat(sesiId, s.id)),
    ...slideIds.map((s) => kunci.sesiJawab(sesiId, s.id)),
  );

  // Pemetaan kode→sesiId dihidupkan lagi supaya peserta kelas berikutnya bisa
  // langsung masuk tanpa menunggu presenter membuka layarnya lebih dulu.
  await redis.set(kunci.kodeSesi(kodeDipakai), String(sesiId), 'EX', TTL_SESI_DETIK);

  log.info({ sesiId, kode: kodeDipakai }, 'Seluruh sesi direset (jawaban + peserta dikosongkan)');
  return { kode: kodeDipakai };
}

/** Hapus satu sesi beserta seluruh peserta & jawabannya (ON DELETE CASCADE). */
export async function hapusSesi(sesiId: number, guruId: number): Promise<void> {
  const baris = sesiUntukGuru(sesiId, guruId);

  const db = getDb();
  const slideIds = db
    .prepare('SELECT id FROM slide WHERE presentasi_id = ?')
    .all(baris.presentasi_id) as { id: number }[];

  db.prepare('DELETE FROM sesi WHERE id = ?').run(sesiId);

  await redisUmum().del(
    kunci.kodeSesi(baris.kode),
    kunci.sesi(sesiId),
    kunci.sesiPeserta(sesiId),
    kunci.sesiHadir(sesiId),
    kunci.skor(sesiId),
    ...slideIds.map((s) => kunci.agregat(sesiId, s.id)),
    ...slideIds.map((s) => kunci.sesiJawab(sesiId, s.id)),
  );

  log.info({ sesiId }, 'Sesi dihapus permanen');
}

/* ────────────────────────────────────── Peserta ────────────────────────────────────── */

export interface HasilJoin {
  token: string;
  pesertaId: number;
  kondisi: KondisiSesi;
}

export async function joinPeserta(
  kodeMentah: string,
  namaMentah: string,
  tokenLama?: string,
): Promise<HasilJoin> {
  const sesiId = await cariSesiIdDariKode(kodeMentah);
  if (!sesiId) throw galatTidakDitemukan('Kode tidak ditemukan atau sesi sudah selesai.');

  const baris = ambilSesi(sesiId);
  if (baris.status === 'selesai') throw galatSesiDitutup('Sesi ini sudah selesai.');

  const db = getDb();
  const redis = redisUmum();

  // Rejoin: token lama dikenali → kembalikan identitas yang sama, jangan buat
  // peserta baru. Ini krusial — tanpa ini, refresh HP akan menggandakan jumlah
  // peserta dan memungkinkan vote dua kali dengan cara paling sederhana.
  if (tokenLama) {
    const existing = db
      .prepare('SELECT id, nama, skor FROM peserta WHERE sesi_id = ? AND token = ?')
      .get(sesiId, tokenLama) as { id: number; nama: string; skor: number } | undefined;

    if (existing) {
      db.prepare(`UPDATE peserta SET last_seen_at = datetime('now') WHERE id = ?`).run(existing.id);
      await redis.hset(kunci.sesiPeserta(sesiId), {
        [tokenLama]: JSON.stringify({ id: existing.id, nama: existing.nama, skor: existing.skor }),
      });
      await redis.zadd(kunci.sesiHadir(sesiId), Date.now(), tokenLama);

      return { token: tokenLama, pesertaId: existing.id, kondisi: await kondisiSesi(sesiId, tokenLama) };
    }
    // token lama tidak ditemukan (mis. sesi lain / sudah lama kedaluwarsa) —
    // lanjut sebagai peserta baru di bawah, jangan lempar galat ke pengguna.
  }

  if (baris.status === 'berjalan' && baris.izinkan_join_telat === 0) {
    throw galatSesiDitutup('Sesi ini tidak menerima peserta baru.');
  }

  let nama = namaMentah.trim().slice(0, BATAS.nama);
  if (nama === '') nama = `Anonim-${randomInt(1000, 9999)}`;

  const tokenBaru = randomUUID();
  const info = db
    .prepare('INSERT INTO peserta (sesi_id, token, nama) VALUES (?, ?, ?)')
    .run(sesiId, tokenBaru, nama);
  const pesertaId = Number(info.lastInsertRowid);

  await redis.hset(kunci.sesiPeserta(sesiId), {
    [tokenBaru]: JSON.stringify({ id: pesertaId, nama, skor: 0 }),
  });
  await redis.expire(kunci.sesiPeserta(sesiId), TTL_SESI_DETIK);
  await redis.zadd(kunci.sesiHadir(sesiId), Date.now(), tokenBaru);
  await redis.zadd(kunci.skor(sesiId), 0, String(pesertaId));

  log.info({ sesiId, pesertaId, nama }, 'Peserta bergabung');

  return { token: tokenBaru, pesertaId, kondisi: await kondisiSesi(sesiId, tokenBaru) };
}

export async function catatKehadiran(sesiId: number, token: string): Promise<void> {
  await redisUmum().zadd(kunci.sesiHadir(sesiId), Date.now(), token);
}

/**
 * Tandai peserta tidak lagi online (socket-nya putus). Hanya menyentuh ZSET
 * kehadiran — baris `peserta` di SQLite dan skornya sengaja TIDAK disentuh,
 * karena putus koneksi sesaat (ganti tab, WiFi sekolah berkedip) harus bisa
 * dipulihkan utuh lewat rejoin dengan token yang sama.
 */
export async function hapusKehadiran(sesiId: number, token: string): Promise<void> {
  await redisUmum().zrem(kunci.sesiHadir(sesiId), token);
}

/** Nama peserta yang sudah join, dalam urutan bergabung — untuk daftar di lobby
 *  layar presenter, sebelum guru menekan "Mulai Presentasi". */
export function daftarPesertaSesi(sesiId: number): { nama: string }[] {
  return getDb()
    .prepare('SELECT nama FROM peserta WHERE sesi_id = ? ORDER BY id')
    .all(sesiId) as { nama: string }[];
}

export async function jumlahPeserta(sesiId: number): Promise<{ online: number; total: number }> {
  const redis = redisUmum();
  const AMBANG_ONLINE_MS = 30_000;
  const [total, online] = await Promise.all([
    redis.hlen(kunci.sesiPeserta(sesiId)),
    redis.zcount(kunci.sesiHadir(sesiId), Date.now() - AMBANG_ONLINE_MS, '+inf'),
  ]);
  return { online, total };
}

/* ────────────────────────────── Skor & leaderboard (Kahoot) ────────────────────────────── */

/**
 * Tambahkan poin ke skor peserta (SQLite = arsip, Redis ZSET = leaderboard live,
 * dan field `skor` di hash `rfl:sesi:{id}:peserta` supaya join/rejoin berikutnya
 * langsung melihat skor terbaru tanpa query tambahan). Mengembalikan skor total
 * TERBARU peserta itu.
 */
export async function tambahSkorPeserta(sesiId: number, pesertaId: number, tambahan: number): Promise<number> {
  const db = getDb();
  db.prepare('UPDATE peserta SET skor = skor + ? WHERE id = ?').run(tambahan, pesertaId);

  const baris = db
    .prepare('SELECT token, nama, skor FROM peserta WHERE id = ?')
    .get(pesertaId) as { token: string; nama: string; skor: number };

  const redis = redisUmum();
  await redis.zincrby(kunci.skor(sesiId), tambahan, String(pesertaId));
  await redis.hset(kunci.sesiPeserta(sesiId), {
    [baris.token]: JSON.stringify({ id: pesertaId, nama: baris.nama, skor: baris.skor }),
  });

  return baris.skor;
}

/** Peringkat 1-based peserta di leaderboard sesi saat ini. */
export async function peringkatPeserta(sesiId: number, pesertaId: number): Promise<number> {
  const rank = await redisUmum().zrevrank(kunci.skor(sesiId), String(pesertaId));
  return (rank ?? 0) + 1;
}

/**
 * Top-N leaderboard. Bulk-fetch nama peserta dengan SATU query ber-IN-clause —
 * bukan query per baris, meski N kecil (≤10); disiplin yang sama dipakai
 * konsisten di seluruh project supaya tidak ada kebiasaan N+1 yang menyelinap.
 */
export async function leaderboardSesi(sesiId: number, n = 10): Promise<BarisPeringkat[]> {
  const mentah = await redisUmum().zrevrange(kunci.skor(sesiId), 0, n - 1, 'WITHSCORES');
  if (mentah.length === 0) return [];

  const idPeserta: number[] = [];
  const skorPerId = new Map<number, number>();
  for (let i = 0; i < mentah.length; i += 2) {
    const id = Number(mentah[i]);
    idPeserta.push(id);
    skorPerId.set(id, Number(mentah[i + 1]));
  }

  const placeholder = idPeserta.map(() => '?').join(',');
  const barisNama = getDb()
    .prepare(`SELECT id, nama FROM peserta WHERE id IN (${placeholder})`)
    .all(...idPeserta) as { id: number; nama: string }[];
  const namaPerId = new Map(barisNama.map((b) => [b.id, b.nama]));

  return idPeserta.map((id, i) => ({
    id,
    nama: namaPerId.get(id) ?? '???',
    skor: skorPerId.get(id) ?? 0,
    peringkat: i + 1,
  }));
}

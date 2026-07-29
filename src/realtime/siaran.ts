import { getDb } from '../db/index.js';
import { leaderboardSesi } from '../layanan/sesi.js';
import { log } from '../log.js';
import { bacaAgregat } from '../redis/agregat.js';
import { JEDA_SIARAN_MS } from '../../shared/konstanta.js';
import type { KonfigSlide, Opsi, TipeSlide } from '../../shared/tipe.js';
import type { IoServer } from './index.js';

/**
 * Broadcaster ter-coalesce — optimasi dengan dampak terbesar di seluruh aplikasi.
 *
 * Tanpa ini: 500 siswa submit bersamaan = 500 broadcast × 500 socket = 250.000
 * pesan. Dengan ini: slide ditandai "kotor", satu timer mengirim snapshot
 * agregat maksimal 4×/detik (250ms) per slide — 500 jawaban jadi 4 broadcast,
 * turun ~99%, dan tetap terasa instan bagi mata manusia.
 */

const kotor = new Map<string, { sesiId: number; slideId: number }>();

/** Dipanggil dari handler `peserta:jawab` setiap ada jawaban baru masuk. */
export function tandaiKotor(sesiId: number, slideId: number): void {
  kotor.set(`${sesiId}:${slideId}`, { sesiId, slideId });
}

interface BarisSlideRingkas {
  tipe: string;
  konfig_json: string;
}

function ambilSlideRingkas(
  slideId: number,
): { tipe: TipeSlide; konfig: KonfigSlide; opsi: Opsi[] } | null {
  const db = getDb();
  const s = db.prepare('SELECT tipe, konfig_json FROM slide WHERE id = ?').get(slideId) as
    | BarisSlideRingkas
    | undefined;
  if (!s) return null;

  const opsi = db
    .prepare('SELECT id, urutan, teks FROM opsi WHERE slide_id = ? ORDER BY urutan')
    .all(slideId) as Opsi[];

  return { tipe: s.tipe as TipeSlide, konfig: JSON.parse(s.konfig_json) as KonfigSlide, opsi };
}

/**
 * Kirim snapshot agregat slide ini SEKARANG (di luar jadwal timer).
 *
 * Dipakai saat presenter membuka sesi atau berpindah slide — baik maju maupun
 * MUNDUR ke slide yang sudah punya data sebelumnya. Tanpa ini, kembali ke slide
 * lama akan tampak kosong sampai ada jawaban baru masuk, padahal datanya sudah ada.
 */
export async function siarkanSekarang(io: IoServer, sesiId: number, slideId: number): Promise<void> {
  const info = ambilSlideRingkas(slideId);
  if (!info) return;

  const agregat = await bacaAgregat(sesiId, slideId, info.tipe, info.opsi, info.konfig);
  io.to(`sesi:${sesiId}:presenter`).emit('agg:update', { slideId, agregat });
  if (info.konfig.tampilkan_hasil_ke_peserta) {
    io.to(`sesi:${sesiId}`).emit('agg:update', { slideId, agregat });
  }
}

interface BarisOpsiBenar {
  id: number;
  urutan: number;
  teks: string;
  benar: number;
}

interface BarisJawabanPin {
  nilai_json: string;
  benar: number;
}

/**
 * Momen "reveal" — dipanggil sekali saat guru MENGUNCI sebuah slide berpoin.
 * Baru di sinilah jawaban benar boleh dikirim ke klien; sebelum ini opsi selalu
 * dikirim tanpa penanda jawaban benar (lihat `slideUntukPengiriman` di sesi.ts)
 * supaya tidak bisa dibaca lebih dulu lewat DevTools selama waktu masih berjalan.
 *
 * `opsi` selalu diisi dari kolom `benar` (relevan untuk kuis/benar_salah). Untuk
 * `puzzle`, opsi ini SUDAH terurut `ORDER BY urutan` — urutan array itu sendiri
 * adalah kunci jawabannya, tidak perlu field terpisah. Untuk `ketik_jawaban` dan
 * `pin_jawaban` (yang tidak punya baris `opsi` sama sekali), info tambahan
 * dikirim lewat `kunciTambahan`.
 */
export async function siarkanHasilKuis(io: IoServer, sesiId: number, slideId: number): Promise<void> {
  const db = getDb();
  const info = ambilSlideRingkas(slideId);
  if (!info) return;

  const barisOpsi = db
    .prepare('SELECT id, urutan, teks, benar FROM opsi WHERE slide_id = ? ORDER BY urutan')
    .all(slideId) as BarisOpsiBenar[];

  const opsi: Opsi[] = barisOpsi.map((o) => ({
    id: o.id,
    urutan: o.urutan,
    teks: o.teks,
    benar: o.benar === 1,
  }));

  let kunciTambahan: unknown;
  if (info.tipe === 'ketik_jawaban') {
    kunciTambahan = { jawabanDiterima: info.konfig.jawaban_diterima ?? [] };
  } else if (info.tipe === 'pin_jawaban' && info.konfig.area_benar) {
    const barisJawaban = db
      .prepare('SELECT nilai_json, benar FROM jawaban WHERE sesi_id = ? AND slide_id = ? AND disembunyikan = 0')
      .all(sesiId, slideId) as BarisJawabanPin[];
    const titik = barisJawaban.map((b) => {
      const posisi = JSON.parse(b.nilai_json) as { x: number; y: number };
      return { x: posisi.x, y: posisi.y, benar: b.benar === 1 };
    });
    kunciTambahan = { areaBenar: info.konfig.area_benar, titik };
  }

  // Sebaran "berapa peserta memilih opsi mana" — hanya untuk tipe yang memang
  // punya baris opsi. Sengaja dikirim DI SINI (saat reveal), bukan lewat
  // `agg:update` selama timer berjalan, supaya jumlah suara tiap opsi tidak
  // bisa dipakai peserta menebak jawaban mayoritas sebelum waktunya habis.
  let sebaran: Record<string, number> | undefined;
  if (info.tipe === 'kuis' || info.tipe === 'benar_salah') {
    const agregat = await bacaAgregat(sesiId, slideId, info.tipe, info.opsi, info.konfig);
    if (agregat.bentuk === 'hitung') sebaran = agregat.data;
  }

  io.to(`sesi:${sesiId}`).emit('kuis:hasil', { slideId, opsi, kunciTambahan, sebaran });
  io.to(`sesi:${sesiId}:presenter`).emit('kuis:hasil', { slideId, opsi, kunciTambahan, sebaran });

  const top = await leaderboardSesi(sesiId, 10);
  io.to(`sesi:${sesiId}:presenter`).emit('kuis:leaderboard', { slideId, top });
  io.to(`sesi:${sesiId}`).emit('kuis:leaderboard', { slideId, top });
}

let timer: NodeJS.Timeout | null = null;

export function mulaiBroadcaster(io: IoServer): void {
  if (timer) return;
  timer = setInterval(() => void tick(io), JEDA_SIARAN_MS);
  timer.unref();
  log.info({ jedaMs: JEDA_SIARAN_MS }, 'Broadcaster agregat ter-coalesce aktif');
}

async function tick(io: IoServer): Promise<void> {
  if (kotor.size === 0) return;
  const batch = [...kotor.values()];
  kotor.clear();

  for (const { sesiId, slideId } of batch) {
    try {
      await siarkanSekarang(io, sesiId, slideId);
    } catch (e) {
      log.error({ err: e, sesiId, slideId }, 'Gagal menyiarkan agregat');
    }
  }
}

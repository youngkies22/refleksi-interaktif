import { getDb } from '../db/index.js';
import { redisUmum } from '../redis/client.js';
import { TTL_SESI_DETIK } from '../../shared/konstanta.js';
import type { AgregatSlide, JawabanPayload, KonfigSlide, Opsi, TipeSlide } from '../../shared/tipe.js';
import { kunci } from './kunci.js';

/**
 * Agregat per tipe slide Menti (wordcloud/pilihan_ganda/open_ended/skala/peringkat).
 * Tipe Kahoot punya jalur skor sendiri — ditambahkan di Fase 5.
 *
 * Prinsip: Redis di sini HANYA cache yang boleh hilang kapan saja. Setiap fungsi
 * `terapkan*` melakukan increment atomik (HINCRBY/ZINCRBY/LPUSH), bukan
 * read-modify-write — penting karena banyak peserta submit bersamaan, dan
 * command atomik Redis membuat itu aman tanpa lock tambahan. `rehidrasiJikaPerlu`
 * membangun ulang key yang sama persis dari tabel `jawaban` di SQLite dengan
 * me-replay urutan penerapan yang sama, sehingga hasil rehidrasi identik dengan
 * seolah-olah Redis tidak pernah hilang.
 */

const MAKS_OPEN_ENDED_TERSIMPAN = 500;
const MAKS_OPEN_ENDED_DIKIRIM = 200;
const MAKS_KATA_DIKIRIM = 50;

export function pecahKataWordcloud(teksMentah: string, maksKata: number): string[] {
  return teksMentah
    .split(/[\s,]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
    .slice(0, Math.max(1, maksKata));
}

/** Diterapkan tepat setelah satu jawaban berhasil ditulis ke SQLite. */
export async function terapkanJawaban(
  sesiId: number,
  slideId: number,
  payload: JawabanPayload,
  konteks: { jawabanId: number; nama: string | null; maksKata: number },
): Promise<void> {
  const redis = redisUmum();
  const k = kunci.agregat(sesiId, slideId);

  switch (payload.tipe) {
    // `kuis`/`benar_salah` disimpan dengan bentuk yang sama seperti pilihan_ganda
    // (HASH opsiId → jumlah). Bedanya hanya KAPAN boleh dibaca: sebaran ini tidak
    // pernah ditampilkan selama timer berjalan, baru ikut dikirim di payload
    // `kuis:hasil` saat reveal (lihat siarkanHasilKuis di realtime/siaran.ts).
    case 'kuis':
    case 'benar_salah':
    case 'pilihan_ganda': {
      await redis.hincrby(k, String(payload.opsiId), 1);
      break;
    }
    case 'skala': {
      await redis.hincrby(k, String(payload.nilai), 1);
      break;
    }
    case 'wordcloud': {
      const kata = pecahKataWordcloud(payload.teks, konteks.maksKata);
      for (const kt of kata) await redis.zincrby(k, 1, kt);
      break;
    }
    case 'open_ended': {
      const entri = JSON.stringify({
        id: konteks.jawabanId,
        nama: konteks.nama,
        teks: payload.teks,
        ts: Date.now(),
      });
      await redis.lpush(k, entri);
      await redis.ltrim(k, 0, MAKS_OPEN_ENDED_TERSIMPAN - 1);
      break;
    }
    case 'peringkat': {
      const pipeline = redis.pipeline();
      payload.urutan.forEach((opsiId, i) => pipeline.hincrby(k, String(opsiId), i + 1));
      pipeline.hincrby(k, '_n', 1);
      await pipeline.exec();
      break;
    }
    default:
      // kuis / benar_salah / ketik_jawaban / puzzle / pin_jawaban — jalur Fase 5.
      return;
  }
  await redis.expire(k, TTL_SESI_DETIK);
}

/** Snapshot agregat untuk disiarkan — dipanggil dari broadcaster ter-coalesce (siaran.ts). */
export async function bacaAgregat(
  sesiId: number,
  slideId: number,
  tipe: TipeSlide,
  opsi: Opsi[],
  konfig: KonfigSlide,
): Promise<AgregatSlide> {
  const redis = redisUmum();
  const k = kunci.agregat(sesiId, slideId);

  switch (tipe) {
    case 'kuis':
    case 'benar_salah':
    case 'pilihan_ganda': {
      const mentah = await redis.hgetall(k);
      const data: Record<string, number> = {};
      let total = 0;
      for (const o of opsi) {
        const v = Number(mentah[String(o.id)] ?? 0);
        data[String(o.id)] = v;
        total += v;
      }
      return { bentuk: 'hitung', data, total };
    }
    case 'skala': {
      const mentah = await redis.hgetall(k);
      const min = konfig.min ?? 1;
      const maks = konfig.maks ?? 5;
      const data: Record<string, number> = {};
      let total = 0;
      for (let n = min; n <= maks; n++) {
        const v = Number(mentah[String(n)] ?? 0);
        data[String(n)] = v;
        total += v;
      }
      return { bentuk: 'hitung', data, total };
    }
    case 'wordcloud': {
      const semua = await redis.zrevrange(k, 0, -1, 'WITHSCORES');
      const pasangan: { kata: string; jumlah: number }[] = [];
      for (let i = 0; i < semua.length; i += 2) {
        pasangan.push({ kata: semua[i]!, jumlah: Number(semua[i + 1]) });
      }
      const total = pasangan.reduce((s, p) => s + p.jumlah, 0);
      return { bentuk: 'kata', data: pasangan.slice(0, MAKS_KATA_DIKIRIM), total };
    }
    case 'open_ended': {
      const mentah = await redis.lrange(k, 0, MAKS_OPEN_ENDED_DIKIRIM - 1);
      const data = mentah.map(
        (s) => JSON.parse(s) as { id: number; nama: string | null; teks: string; ts: number },
      );
      const total = await redis.llen(k);
      return { bentuk: 'teks', data, total };
    }
    case 'peringkat': {
      const mentah = await redis.hgetall(k);
      const n = Number(mentah['_n'] ?? 0);
      const data = opsi.map((o) => ({
        opsiId: o.id,
        rataPosisi: n > 0 ? Number(mentah[String(o.id)] ?? 0) / n : 0,
      }));
      return { bentuk: 'posisi', data, total: n };
    }
    default:
      return { bentuk: 'hitung', data: {}, total: 0 };
  }
}

interface BarisJawabanMentah {
  id: number;
  nilai_teks: string | null;
  opsi_id: number | null;
  nilai_angka: number | null;
  nilai_json: string | null;
  created_at: string;
  nama: string | null;
}

/**
 * Bangun ulang agregat dari SQLite kalau key Redis-nya belum/tidak ada.
 * Dipanggil lazy — hanya slide yang benar-benar dibuka presenter yang direhidrasi,
 * bukan seluruh slide dalam presentasi sekaligus.
 */
export async function rehidrasiAgregatJikaPerlu(
  sesiId: number,
  slideId: number,
  tipe: TipeSlide,
  konfig: KonfigSlide,
): Promise<void> {
  const redis = redisUmum();
  const k = kunci.agregat(sesiId, slideId);
  if (await redis.exists(k)) return;

  const db = getDb();
  const baris = db
    .prepare(
      `SELECT j.id, j.nilai_teks, j.opsi_id, j.nilai_angka, j.nilai_json, j.created_at, p.nama
       FROM jawaban j JOIN peserta p ON p.id = j.peserta_id
       WHERE j.sesi_id = ? AND j.slide_id = ? AND j.disembunyikan = 0
       ORDER BY j.created_at`,
    )
    .all(sesiId, slideId) as BarisJawabanMentah[];

  if (baris.length === 0) return;

  const maksKata = konfig.maks_kata ?? 3;

  for (const b of baris) {
    if ((tipe === 'pilihan_ganda' || tipe === 'kuis' || tipe === 'benar_salah') && b.opsi_id != null) {
      await redis.hincrby(k, String(b.opsi_id), 1);
    } else if (tipe === 'skala' && b.nilai_angka != null) {
      await redis.hincrby(k, String(b.nilai_angka), 1);
    } else if (tipe === 'wordcloud' && b.nilai_teks) {
      for (const kt of pecahKataWordcloud(b.nilai_teks, maksKata)) await redis.zincrby(k, 1, kt);
    } else if (tipe === 'open_ended' && b.nilai_teks) {
      await redis.lpush(
        k,
        JSON.stringify({ id: b.id, nama: b.nama, teks: b.nilai_teks, ts: new Date(b.created_at).getTime() }),
      );
    } else if (tipe === 'peringkat' && b.nilai_json) {
      const urutan = JSON.parse(b.nilai_json) as number[];
      const pipeline = redis.pipeline();
      urutan.forEach((opsiId, i) => pipeline.hincrby(k, String(opsiId), i + 1));
      pipeline.hincrby(k, '_n', 1);
      await pipeline.exec();
    }
  }

  if (tipe === 'open_ended') await redis.ltrim(k, 0, MAKS_OPEN_ENDED_TERSIMPAN - 1);
  await redis.expire(k, TTL_SESI_DETIK);
}

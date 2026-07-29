import { getDb } from '../db/index.js';
import {
  galatSesiDitutup,
  galatSudahMenjawab,
  galatTerlaluCepat,
  galatTidakDiizinkan,
  galatTidakDitemukan,
  galatValidasi,
} from '../galat.js';
import { peringkatPeserta, tambahSkorPeserta } from './sesi.js';
import { redisUmum } from '../redis/client.js';
import { kunci } from '../redis/kunci.js';
import { terapkanJawaban } from '../redis/agregat.js';
import { cocokKetikJawaban } from '../util/teks.js';
import { ANTISPAM, BATAS, BATAS_DETIK_BAWAAN, hitungPoin, TTL_SESI_DETIK } from '../../shared/konstanta.js';
import { slideBerpoin, type JawabanPayload, type KonfigSlide, type Slide, type TipeSlide } from '../../shared/tipe.js';

/** Dikembalikan `submitJawaban` hanya untuk tipe berpoin — dipakai socket handler
 *  mengirim event pribadi `kuis:umpan_balik` ke peserta yang baru menjawab. */
export interface UmpanBalikKuis {
  benar: boolean;
  ketepatan: number;
  poin: number;
  skorTotal: number;
  peringkat: number;
}

/**
 * Validasi & simpan jawaban peserta. Urutan operasi di `submitJawaban` PENTING:
 * payload divalidasi SEBELUM token dicatat sebagai "sudah menjawab" (SADD).
 * Kalau urutannya dibalik, satu jawaban yang ditolak karena tidak valid akan
 * tetap mengunci peserta itu dari mencoba lagi — permanen selama slide aktif,
 * karena SADD sudah terlanjur menandai tokennya. Baris kode di bawah sengaja
 * dijaga urutannya, jangan diubah tanpa menyadari implikasi ini.
 */

interface BarisSlideMentah {
  id: number;
  presentasi_id: number;
  tipe: string;
  pertanyaan: string;
  konfig_json: string;
}

interface KolomJawaban {
  nilai_teks: string | null;
  opsi_id: number | null;
  nilai_angka: number | null;
  nilai_json: string | null;
}

/**
 * Satu-satunya tempat aturan "bentuk jawaban yang valid untuk tipe X" ditegakkan.
 * Switch ini exhaustive atas seluruh TipeSlide — menambah tipe baru ke union
 * `JawabanPayload` akan membuat compiler menandai fungsi ini kalau ada tipe
 * yang belum ditangani.
 */
function validasiPayload(slide: Slide, payload: JawabanPayload): KolomJawaban {
  if (payload.tipe !== slide.tipe) {
    throw galatValidasi('Tipe jawaban tidak cocok dengan tipe slide.');
  }

  switch (payload.tipe) {
    case 'pilihan_ganda':
    case 'kuis':
    case 'benar_salah': {
      if (!slide.opsi.some((o) => o.id === payload.opsiId)) {
        throw galatValidasi('Opsi tidak valid.');
      }
      return { nilai_teks: null, opsi_id: payload.opsiId, nilai_angka: null, nilai_json: null };
    }

    case 'wordcloud': {
      const teks = payload.teks.trim();
      if (teks === '') throw galatValidasi('Jawaban tidak boleh kosong.');
      if (teks.length > BATAS.kata * 5) throw galatValidasi('Jawaban terlalu panjang.');
      return { nilai_teks: teks, opsi_id: null, nilai_angka: null, nilai_json: null };
    }

    case 'open_ended': {
      const teks = payload.teks.trim();
      if (teks === '') throw galatValidasi('Jawaban tidak boleh kosong.');
      if (teks.length > BATAS.openEnded) {
        throw galatValidasi(`Jawaban maksimal ${BATAS.openEnded} karakter.`);
      }
      return { nilai_teks: teks, opsi_id: null, nilai_angka: null, nilai_json: null };
    }

    case 'ketik_jawaban': {
      const teks = payload.teks.trim();
      if (teks === '') throw galatValidasi('Jawaban tidak boleh kosong.');
      if (teks.length > BATAS.ketikJawaban) {
        throw galatValidasi(`Jawaban maksimal ${BATAS.ketikJawaban} karakter.`);
      }
      return { nilai_teks: teks, opsi_id: null, nilai_angka: null, nilai_json: null };
    }

    case 'skala': {
      const min = slide.konfig.min ?? 1;
      const maks = slide.konfig.maks ?? 5;
      if (!Number.isInteger(payload.nilai) || payload.nilai < min || payload.nilai > maks) {
        throw galatValidasi(`Nilai harus bilangan bulat antara ${min} dan ${maks}.`);
      }
      return { nilai_teks: null, opsi_id: null, nilai_angka: payload.nilai, nilai_json: null };
    }

    case 'peringkat':
    case 'puzzle': {
      const idOpsiSlide = new Set(slide.opsi.map((o) => o.id));
      const idUnikKiriman = new Set(payload.urutan);
      const cocok =
        payload.urutan.length === slide.opsi.length &&
        idUnikKiriman.size === idOpsiSlide.size &&
        payload.urutan.every((id) => idOpsiSlide.has(id));
      if (!cocok) throw galatValidasi('Urutan tidak valid.');
      return { nilai_teks: null, opsi_id: null, nilai_angka: null, nilai_json: JSON.stringify(payload.urutan) };
    }

    case 'pin_jawaban': {
      if (payload.x < 0 || payload.x > 1 || payload.y < 0 || payload.y > 1) {
        throw galatValidasi('Koordinat tidak valid.');
      }
      return {
        nilai_teks: null,
        opsi_id: null,
        nilai_angka: null,
        nilai_json: JSON.stringify({ x: payload.x, y: payload.y }),
      };
    }
  }
}

/**
 * Slide "penuh" untuk kebutuhan INTERNAL server (validasi + skor) — beda dari
 * `slideUntukPengiriman` di sesi.ts yang sengaja menyembunyikan `benar`.
 * Fungsi ini TIDAK PERNAH boleh nilainya dikirim balik ke klien mentah-mentah.
 */
function ambilSlideLengkap(slideId: number): Slide {
  const db = getDb();
  const s = db.prepare('SELECT * FROM slide WHERE id = ?').get(slideId) as
    | BarisSlideMentah
    | undefined;
  if (!s) throw galatTidakDitemukan('Slide tidak ditemukan.');

  const opsi = db
    .prepare('SELECT id, urutan, teks, benar FROM opsi WHERE slide_id = ? ORDER BY urutan')
    .all(slideId) as { id: number; urutan: number; teks: string; benar: number }[];

  return {
    id: s.id,
    urutan: 0,
    tipe: s.tipe as TipeSlide,
    pertanyaan: s.pertanyaan,
    konfig: JSON.parse(s.konfig_json) as KonfigSlide,
    opsi: opsi.map((o) => ({ id: o.id, urutan: o.urutan, teks: o.teks, benar: o.benar === 1 })),
  };
}

/**
 * Ketepatan (0..1) untuk seluruh keluarga Kahoot. Ini satu-satunya bagian yang
 * benar-benar berbeda antar tipe berpoin — jalur skor/timer/leaderboard di
 * `submitJawaban` sama untuk semuanya.
 */
function hitungKetepatan(slide: Slide, payload: JawabanPayload): number {
  switch (payload.tipe) {
    case 'kuis':
    case 'benar_salah': {
      const opsiTerpilih = slide.opsi.find((o) => o.id === payload.opsiId);
      return opsiTerpilih?.benar ? 1 : 0;
    }

    case 'ketik_jawaban': {
      const diterima = slide.konfig.jawaban_diterima ?? [];
      const cocokPersis = slide.konfig.cocok_persis ?? false;
      return cocokKetikJawaban(payload.teks, diterima, cocokPersis) ? 1 : 0;
    }

    case 'puzzle': {
      // `slide.opsi` sudah terurut oleh `urutan` — itulah kunci jawabannya,
      // ditetapkan guru saat menyusun opsi di editor (lihat presentasi.ts).
      const benar = slide.opsi.map((o) => o.id);
      const jumlahTepat = payload.urutan.filter((id, i) => id === benar[i]).length;
      if (jumlahTepat === benar.length) return 1;
      const poinParsial = slide.konfig.poin_parsial ?? true;
      return poinParsial ? jumlahTepat / benar.length : 0;
    }

    case 'pin_jawaban': {
      const area = slide.konfig.area_benar;
      if (!area) return 0;
      if (area.bentuk === 'kotak') {
        const didalam =
          payload.x >= area.x && payload.x <= area.x + area.w &&
          payload.y >= area.y && payload.y <= area.y + area.h;
        return didalam ? 1 : 0;
      }
      // lingkaran: pusat di (x + w/2, y + h/2), radius = w/2 (w===h untuk lingkaran).
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      const r = area.w / 2;
      const jarak = Math.hypot(payload.x - cx, payload.y - cy);
      return jarak <= r ? 1 : 0;
    }

    default:
      return 0;
  }
}

export async function submitJawaban(
  sesiId: number,
  slideId: number,
  token: string,
  payload: JawabanPayload,
): Promise<{ umpanBalik: UmpanBalikKuis | null }> {
  const redis = redisUmum();

  // 1) Rate limit — murah, ditolak duluan sebelum menyentuh DB sama sekali.
  const kunciRate = kunci.rateJawaban(token);
  const jumlahKirim = await redis.incr(kunciRate);
  if (jumlahKirim === 1) await redis.expire(kunciRate, ANTISPAM.jawabanJendelaDetik);
  if (jumlahKirim > ANTISPAM.jawabanMaks) throw galatTerlaluCepat();

  // 2) Slide harus ada.
  const slide = ambilSlideLengkap(slideId);
  const berpoin = slideBerpoin(slide.tipe);

  // 3) Peserta harus benar terdaftar di sesi ini dengan token itu.
  const db = getDb();
  const peserta = db
    .prepare('SELECT id, nama FROM peserta WHERE sesi_id = ? AND token = ?')
    .get(sesiId, token) as { id: number; nama: string } | undefined;
  if (!peserta) throw galatTidakDiizinkan('Anda belum bergabung ke sesi ini.');

  // 4) Sesi & slide harus masih dalam kondisi menerima jawaban.
  const hashSesi = await redis.hgetall(kunci.sesi(sesiId));
  if (hashSesi.status === 'selesai') throw galatSesiDitutup('Sesi ini sudah selesai.');
  if (Number(hashSesi.slideAktifId) !== slideId) {
    throw galatSesiDitutup('Pertanyaan ini sudah tidak aktif.');
  }
  if (hashSesi.slideDibuka !== '1') {
    throw galatSesiDitutup('Jawaban untuk pertanyaan ini sudah dikunci.');
  }

  // 5) Validasi bentuk jawaban — SEBELUM anti-double-vote (lihat catatan di atas).
  const kolom = validasiPayload(slide, payload);

  // 5b) Skor Kahoot. `waktuMs` WAJIB dari `mulaiSlideAt` yang disimpan server
  //     saat slide dibuka (langkah 4 di atas) — BUKAN dari timestamp klien,
  //     supaya peserta tidak bisa memalsukan kecepatan jawabnya.
  let ketepatan = 0;
  let waktuMs: number | null = null;
  let poin = 0;
  if (berpoin) {
    const mulaiSlideAt = Number(hashSesi.mulaiSlideAt ?? Date.now());
    waktuMs = Math.max(0, Date.now() - mulaiSlideAt);
    ketepatan = hitungKetepatan(slide, payload);
    const batasMs = (slide.konfig.batas_detik ?? BATAS_DETIK_BAWAAN) * 1000;
    poin = hitungPoin(ketepatan, waktuMs, batasMs);
  }

  // 6) Anti-double-vote. SADD atomik di Redis — aman dari race meski dua event
  //    nyaris bersamaan dari klien yang sama (Redis single-threaded per key).
  const kunciJawab = kunci.sesiJawab(sesiId, slideId);
  const baru = await redis.sadd(kunciJawab, token);
  if (baru === 0) throw galatSudahMenjawab();
  await redis.expire(kunciJawab, TTL_SESI_DETIK);

  // 7) Simpan ke SQLite. Ditulis langsung (bukan batch) — batching ditambahkan
  //    di Fase 7 sebagai optimasi murni, tidak mengubah logika di sini.
  const info = db
    .prepare(
      `INSERT INTO jawaban
         (sesi_id, slide_id, peserta_id, nilai_teks, opsi_id, nilai_angka, nilai_json, ketepatan, benar, waktu_ms, poin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sesiId,
      slideId,
      peserta.id,
      kolom.nilai_teks,
      kolom.opsi_id,
      kolom.nilai_angka,
      kolom.nilai_json,
      ketepatan,
      ketepatan >= 1 ? 1 : 0,
      waktuMs,
      poin,
    );

  // 8) Terapkan ke agregat Redis untuk disiarkan oleh broadcaster ter-coalesce.
  //    Untuk kuis/benar_salah, `terapkanJawaban` sengaja no-op (default:break) —
  //    agregat "pilihan mana yang dipilih" baru terbuka saat reveal (lihat siaran.ts).
  await terapkanJawaban(sesiId, slideId, payload, {
    jawabanId: Number(info.lastInsertRowid),
    nama: peserta.nama,
    maksKata: slide.konfig.maks_kata ?? 3,
  });

  // 9) Skor & umpan balik pribadi — hanya untuk tipe berpoin.
  if (!berpoin) return { umpanBalik: null };

  const skorTotal = await tambahSkorPeserta(sesiId, peserta.id, poin);
  const peringkat = await peringkatPeserta(sesiId, peserta.id);

  return {
    // `benar` berarti TEPAT SEMPURNA (ketepatan===1) — bukan "ada poin sama sekali".
    // Untuk kuis/benar_salah/ketik_jawaban/pin_jawaban ketepatan selalu 0 atau 1,
    // jadi ini tidak mengubah perilaku mereka; untuk puzzle yang bisa punya nilai
    // pecahan (poin parsial), ini mencegah "separuh benar" ditandai "benar".
    umpanBalik: { benar: ketepatan >= 1, ketepatan, poin, skorTotal, peringkat },
  };
}

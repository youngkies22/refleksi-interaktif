import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { galatTerlaluCepat, galatTidakDitemukan, galatValidasi, keGalatKirim, statusDariGalat } from '../../galat.js';
import { cariPapanIdDariKode, komentarKartu } from '../../layanan/papan.js';
import { simpanGambarUnggahan } from '../../layanan/unggah.js';
import { redisUmum } from '../../redis/client.js';
import { kunci } from '../../redis/kunci.js';
import { normalisasiKode } from '../../util/kode.js';
import { ANTISPAM, UNGGAH } from '../../../shared/konstanta.js';

/**
 * Rute PUBLIK (tanpa login guru) — dipisah sengaja dari `rute/api/papan.ts`
 * yang seluruhnya guru-only, supaya batas "siapa boleh akses apa" tetap jelas
 * per-file, bukan tercampur satu route publik di antara yang guru-only.
 */
export async function ruteKartuPublik(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: UNGGAH.maksByte, files: 1 },
  });

  app.get<{ Params: { id: string } }>('/api/kartu/:id/komentar', async (req, balas) => {
    try {
      return { komentar: komentarKartu(Number(req.params.id)) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  /**
   * Unggah lampiran gambar kartu papan — dibuka untuk peserta ANONIM, bukan
   * cuma guru (beda dari `/api/unggah/gambar`). Digerbang oleh dua hal supaya
   * tidak jadi celah banjir-unggah: (1) `token` wajib ada — cuma didapat lewat
   * `papan:masuk` via socket, jadi tidak bisa ditebak orang yang belum join;
   * (2) rate limit per-token yang SAMA dengan batas kirim kartu
   * (`ANTISPAM.kartuMaks` per `kartuJendelaDetik`) — masuk akal karena satu
   * unggahan biasanya dipasangkan dengan satu kartu.
   */
  app.post<{ Params: { kode: string }; Querystring: { token?: string } }>(
    '/api/papan/:kode/unggah',
    async (req, balas) => {
      try {
        const kode = normalisasiKode(req.params.kode ?? '');
        const token = req.query.token ?? '';
        if (token === '') throw galatValidasi('Token tidak valid — gabung papan ini dulu.');

        const papanId = await cariPapanIdDariKode(kode);
        if (!papanId) throw galatTidakDitemukan('Papan tidak ditemukan.');

        const redis = redisUmum();
        const kunciRate = kunci.rateKartu(token);
        const jumlah = await redis.incr(kunciRate);
        if (jumlah === 1) await redis.expire(kunciRate, ANTISPAM.kartuJendelaDetik);
        if (jumlah > ANTISPAM.kartuMaks) throw galatTerlaluCepat();

        const berkas = await req.file();
        if (!berkas) {
          balas.status(400);
          return { galat: { kode: 'VALIDASI', pesan: 'Tidak ada berkas yang diunggah.' } };
        }

        const buffer = await berkas.toBuffer();
        return await simpanGambarUnggahan(buffer);
      } catch (e) {
        balas.status(statusDariGalat(e));
        return { galat: keGalatKirim(e) };
      }
    },
  );
}

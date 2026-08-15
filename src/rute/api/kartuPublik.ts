import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { galatTerlaluCepat, galatTidakDitemukan, galatValidasi, keGalatKirim, statusDariGalat } from '../../galat.js';
import { cariGuruById } from '../../layanan/auth.js';
import { cariPapanIdDariKode, guruIdPemilikPapan, komentarKartu } from '../../layanan/papan.js';
import { folderGuru, simpanGambarUnggahan } from '../../layanan/unggah.js';
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
  app.post<{ Params: { kode: string }; Querystring: { token?: string; kolomId?: string } }>(
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

        // Folder S3 `guru/{id}-nama/papan/{id}/kolom/{id}/...` (atau
        // `.../kolom/bebas` untuk kartu "dinding" tanpa kolom) — dilabeli
        // guru PEMILIK papan (peserta yang unggah anonim, tidak punya sesi
        // guru). kolomId murni dipakai untuk menyusun key, bukan divalidasi
        // milik papan mana; peserta anonim tidak punya akses ke isi papan
        // lain lewat ini, cuma nama foldernya saja.
        const guruId = guruIdPemilikPapan(papanId);
        const guru = cariGuruById(guruId);
        const kolomMentah = Number(req.query.kolomId);
        const kolom = Number.isInteger(kolomMentah) && kolomMentah > 0 ? String(kolomMentah) : 'bebas';
        const folder = `${folderGuru(guruId, guru?.nama ?? `#${guruId}`)}/papan/${papanId}/kolom/${kolom}`;

        const buffer = await berkas.toBuffer();
        return await simpanGambarUnggahan(buffer, folder);
      } catch (e) {
        balas.status(statusDariGalat(e));
        return { galat: keGalatKirim(e) };
      }
    },
  );
}

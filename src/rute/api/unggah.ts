import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { guruIdWajib } from '../../auth/wajibLogin.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { simpanGambarUnggahan, hapusGambarUnggahan, daftarGambarUnggahan } from '../../layanan/unggah.js';
import { UNGGAH } from '../../../shared/konstanta.js';

export async function ruteUnggah(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: UNGGAH.maksByte, files: 1 },
  });

  app.post('/api/unggah/gambar', async (req, balas) => {
    try {
      guruIdWajib(req);

      const berkas = await req.file();
      if (!berkas) {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Tidak ada berkas yang diunggah.' } };
      }

      const buffer = await berkas.toBuffer();
      const hasil = await simpanGambarUnggahan(buffer);
      return hasil;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.delete('/api/unggah/gambar', async (req, balas) => {
    try {
      guruIdWajib(req);

      const body = (req.body as any) ?? {};
      const path = body.path;
      if (!path || typeof path !== 'string') {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Path gambar tidak valid.' } };
      }

      await hapusGambarUnggahan(path);
      return { ok: true };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get('/api/unggah/daftar', async (req, balas) => {
    try {
      guruIdWajib(req);

      const limit = Math.min(parseInt((req.query as any)?.limit ?? '50'), 100);
      const offset = parseInt((req.query as any)?.offset ?? '0');

      const { gambar, total, pemakaian } = await daftarGambarUnggahan(limit, offset);
      return { gambar, total, pemakaian };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}

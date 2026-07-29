import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { guruIdWajib } from '../../auth/wajibLogin.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { simpanGambarUnggahan } from '../../layanan/unggah.js';
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
}

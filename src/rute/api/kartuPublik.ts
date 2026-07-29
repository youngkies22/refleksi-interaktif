import type { FastifyInstance } from 'fastify';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { komentarKartu } from '../../layanan/papan.js';

/**
 * Rute PUBLIK (tanpa login guru) — dipisah sengaja dari `rute/api/papan.ts`
 * yang seluruhnya guru-only, supaya batas "siapa boleh akses apa" tetap jelas
 * per-file, bukan tercampur satu route publik di antara yang guru-only.
 */
export async function ruteKartuPublik(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/kartu/:id/komentar', async (req, balas) => {
    try {
      return { komentar: komentarKartu(Number(req.params.id)) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}

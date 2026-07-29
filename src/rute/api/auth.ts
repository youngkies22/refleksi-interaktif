import type { FastifyInstance } from 'fastify';
import { guruIdWajib } from '../../auth/wajibLogin.js';
import { cariGuruById, login, ubahProfil, type DataUbahProfil } from '../../layanan/auth.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';

interface BodyLogin {
  username: string;
  password: string;
}

export async function ruteAuth(app: FastifyInstance): Promise<void> {
  app.post<{ Body: BodyLogin }>('/api/auth/masuk', async (req, balas) => {
    try {
      const guru = await login(req.body?.username ?? '', req.body?.password ?? '', req.ip);
      req.session.guruId = guru.id;
      await req.session.save();
      return { guru };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post('/api/auth/keluar', async (req, balas) => {
    await req.session.destroy();
    balas.status(204);
  });

  app.get('/api/auth/saya', async (req, balas) => {
    const id = req.session.guruId;
    const guru = id ? cariGuruById(id) : null;
    if (!guru) {
      balas.status(401);
      return { galat: { kode: 'TIDAK_DIIZINKAN', pesan: 'Belum login.' } };
    }
    return { guru };
  });

  app.patch<{ Body: DataUbahProfil }>('/api/auth/saya', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const guru = ubahProfil(guruId, req.body ?? {});
      return { guru };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}

import type { FastifyInstance } from 'fastify';
import { ambilPengaturan } from '../../layanan/pengaturan.js';

/** Publik (tanpa login) — halaman login & gabung sesi juga butuh nama/logo ini. */
export async function rutePengaturan(app: FastifyInstance): Promise<void> {
  app.get('/api/pengaturan', async () => {
    return { pengaturan: ambilPengaturan() };
  });
}

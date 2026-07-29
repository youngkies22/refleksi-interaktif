import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { redisUmum } from '../redis/client.js';

/**
 * Endpoint healthcheck untuk Docker (`HEALTHCHECK` di Dockerfile) dan untuk
 * pengecekan manual. Sengaja memverifikasi DB dan Redis benar-benar bisa
 * dipakai, bukan cuma "proses masih hidup" — supaya masalah koneksi ketahuan
 * dari status container, bukan baru ketahuan saat guru mengeluh di kelas.
 */
export async function ruteKesehatan(app: FastifyInstance): Promise<void> {
  app.get('/sehat', async (_req, balas) => {
    const hasil: { db: boolean; redis: boolean } = { db: false, redis: false };

    try {
      getDb().prepare('SELECT 1').get();
      hasil.db = true;
    } catch {
      // tetap false
    }

    try {
      const pong = await redisUmum().ping();
      hasil.redis = pong === 'PONG';
    } catch {
      // tetap false
    }

    const sehat = hasil.db && hasil.redis;
    balas.status(sehat ? 200 : 503);
    return { sehat, ...hasil };
  });
}

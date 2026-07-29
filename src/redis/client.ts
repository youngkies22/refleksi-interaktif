import { Redis } from 'ioredis';
import { config } from '../config.js';
import { log } from '../log.js';

/**
 * Klien Redis tunggal (singleton) untuk seluruh aplikasi.
 *
 * `retryStrategy` WAJIB ada — ini yang membuat urutan boot container tidak jadi
 * masalah. Kalau `app` menyala lebih dulu daripada `redis` (docker-compose tidak
 * menjamin urutan startup, hanya urutan `depends_on`), ioredis akan mencoba lagi
 * dengan jeda menaik alih-alih langsung melempar error dan menjatuhkan proses.
 */
function buatKlien(): Redis {
  const klien = new Redis(config.redisUrl, {
    retryStrategy(percobaan) {
      const jeda = Math.min(percobaan * 500, 5000);
      log.warn({ percobaan, jedaMs: jeda }, 'Redis belum siap, mencoba lagi');
      return jeda;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  klien.on('error', (e) => log.error({ err: e }, 'Galat koneksi Redis'));
  klien.on('connect', () => log.info('Tersambung ke Redis'));
  klien.on('ready', () => log.info('Redis siap dipakai'));
  klien.on('reconnecting', () => log.warn('Menyambung ulang ke Redis...'));

  return klien;
}

let klienUmum: Redis | null = null;

/** Klien untuk operasi biasa (get/set/hash/list/zset). */
export function redisUmum(): Redis {
  if (!klienUmum) klienUmum = buatKlien();
  return klienUmum;
}

/**
 * Socket.IO redis-adapter butuh DUA koneksi terpisah (pub & sub) — Redis tidak
 * bisa memakai satu koneksi yang sama untuk SUBSCRIBE dan perintah biasa sekaligus.
 */
let klienPub: Redis | null = null;
let klienSub: Redis | null = null;

export function redisPub(): Redis {
  if (!klienPub) klienPub = buatKlien();
  return klienPub;
}

export function redisSub(): Redis {
  if (!klienSub) klienSub = buatKlien();
  return klienSub;
}

export async function tutupRedis(): Promise<void> {
  await Promise.allSettled([klienUmum?.quit(), klienPub?.quit(), klienSub?.quit()]);
  klienUmum = null;
  klienPub = null;
  klienSub = null;
  log.info('Koneksi Redis ditutup rapi');
}

import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { log } from '../log.js';

/**
 * Sajikan build Vue (`web/dist`) sebagai file statis, dengan fallback SPA:
 * rute apa pun yang bukan `/api/*` dan tidak cocok berkas nyata dikembalikan
 * `index.html`, supaya Vue Router (mode history) menangani routing di sisi
 * klien untuk path seperti `/gabung/ABC123` atau `/sesi/ABC123/presenter`.
 */
export async function ruteStatis(app: FastifyInstance): Promise<void> {
  if (!existsSync(config.dirWeb)) {
    log.warn(
      { dirWeb: config.dirWeb },
      'Build frontend belum ada — jalankan `npm run build` di folder web/',
    );
  }

  // Gambar unggahan guru (pin_jawaban, papan Padlet) — prefix terpisah dari
  // aset Vue, didaftarkan lebih dulu dengan `decorateReply:false` supaya tidak
  // bertabrakan dengan registrasi @fastify/static kedua di bawah untuk web/dist.
  mkdirSync(config.dirUnggahan, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.dirUnggahan,
    prefix: '/unggahan/',
    decorateReply: false,
  });

  await app.register(fastifyStatic, {
    root: config.dirWeb,
    wildcard: false,
  });

  app.setNotFoundHandler((req, balas) => {
    if (req.raw.url?.startsWith('/api/') || req.raw.url?.startsWith('/socket.io/')) {
      balas.status(404).send({ galat: { kode: 'TIDAK_DITEMUKAN', pesan: 'Rute tidak ada.' } });
      return;
    }
    balas.status(200).sendFile('index.html', resolve(config.dirWeb));
  });
}
